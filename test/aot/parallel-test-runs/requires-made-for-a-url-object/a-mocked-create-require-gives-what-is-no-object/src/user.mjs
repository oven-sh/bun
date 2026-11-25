import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export function make() {
  const place = new URL(import.meta.url);
  place.pathname = place.pathname.replace(/[^/]+$/, "other/start.mjs");
  const load = createRequire(place);
  return typeof load === "function" && load.length > 5 ? load("./part.cjs") : load;
}
export function makeForPath() {
  const place = new URL(import.meta.url);
  place.pathname = place.pathname.replace(/[^/]+$/, "other/start.mjs");
  const load = createRequire(dirname(fileURLToPath(place)) + "/");
  return typeof load === "function" && load.length > 5 ? load("./part.cjs") : load;
}
