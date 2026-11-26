import { createRequire } from "node:module";
const PLACES = ["./broken.json", "./gauge-info.json"];
function markFrom(here, places) {
  let mark = "none";
  try {
    const load = createRequire(here);
    for (const place of places) {
      try {
        mark = load(place).version || mark;
      } catch {}
    }
  } catch {}
  return mark;
}
console.log("SAID", markFrom(import.meta.url, PLACES));
