import { createRequire } from "node:module";
function made(change) {
  const place = new URL(import.meta.url);
  change(place);
  try { const load = createRequire(place); return typeof load("node:path").join; } catch (e) { return e.name + " " + e.code; }
}
console.log("host", made(place => { place.host = "elsewhere"; }));
console.log("slash", made(place => { place.pathname = "/nowhere%2Fat/all/start.mjs"; }));
