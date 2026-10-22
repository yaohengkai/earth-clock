/**
 * Reverse-geocoding proxy for /proxy/geocode/reverse.
 *
 * The frontend (frontend/src/data/geocoder.ts) calls a same-origin endpoint because
 * browsers cannot set the identifying User-Agent that geocoders ask for, and because
 * the upstream/key should be swappable without rebuilding the bundle. On CapRover
 * that endpoint is an NGINX location block; on Netlify it is this function.
 *
 * Upstream is Nominatim-compatible. With LOCATIONIQ_KEY set we use LocationIQ (same
 * response shape, dedicated capacity); without it we fall back to public Nominatim,
 * which rate-limits and often blocks cloud IP ranges — so set the key in production.
 *
 * netlify.toml rewrites /proxy/geocode/reverse here with status 200, so the browser
 * keeps the same URL and the client needs no changes.
 */

const LOCATIONIQ_URL = "https://us1.locationiq.com/v1/reverse";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/** Same identifying UA the NGINX rule sends; Nominatim's usage policy requires one. */
const USER_AGENT = "earth-clock (https://github.com/InfantLab/earth-clock)";

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default async (request) => {
  const params = new URL(request.url).searchParams;
  const lat = params.get("lat");
  const lon = params.get("lon");
  if (!lat || !lon) return json({ error: "lat and lon query parameters are required" }, 400);

  const key = process.env.LOCATIONIQ_KEY;
  const target = new URL(key ? LOCATIONIQ_URL : NOMINATIM_URL);
  target.searchParams.set("format", "json");
  target.searchParams.set("lat", lat);
  target.searchParams.set("lon", lon);
  target.searchParams.set("zoom", params.get("zoom") || "10");
  target.searchParams.set("addressdetails", "1");
  if (key) target.searchParams.set("key", key);

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": request.headers.get("accept-language") || "en",
      },
    });
  } catch (err) {
    console.error("geocode upstream unreachable:", err && err.message ? err.message : err);
    return json({ error: "geocoding upstream unreachable" }, 502);
  }

  // Pass the upstream status through so geocoder.ts can tell "no feature here"
  // (200 with an empty body) from a 5xx it should retry.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
};
