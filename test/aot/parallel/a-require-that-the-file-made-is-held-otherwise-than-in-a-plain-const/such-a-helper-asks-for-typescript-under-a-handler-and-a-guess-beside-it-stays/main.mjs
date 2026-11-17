import { createRequire } from "node:module";
function probe(moduleUrl) {
  const load = createRequire(moduleUrl);
  try {
    load("./extra.ts");
  } catch {}
  return "asked";
}
console.log("SAID", probe(import.meta.url));
const rows = [{ name: "./one.cjs" }];
import.meta.require("./touch.cjs")(rows[0]);
console.log("SAID", import.meta.require(rows[0].name));
