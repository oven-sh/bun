// ES modules import names of CommonJS files whose exports object is the result of a call: required earlier, imported twice, failing, and in a cycle with an ES module.
import { createRequire } from "node:module";
import { value as early } from "./required-earlier.cjs";
import { value as plain, later } from "./plain.cjs";
import { seenByImporter } from "./cycle.cjs";
import "./requires-first.cjs";
console.log(early, plain, later, seenByImporter);
const require = createRequire(import.meta.url);
require("./plain.cjs").value = "changed";
console.log(plain, (await import("./plain.cjs")).value, require("./plain.cjs").value);
for (let round = 0; round < 2; round++) {
  try { console.log((await import("./imports-failing.mjs")).value); } catch (error) { console.log("import", round, error.message); }
  try { console.log(require("./failing.cjs").value); } catch (error) { console.log("require", round, error.message); }
}
console.log((await import("./second-graph.mjs")).default);
