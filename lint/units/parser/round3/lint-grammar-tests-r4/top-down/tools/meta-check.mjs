// For the 99 metadata cases: the expected value of the removed tests is the value that tsc 6.0.2 emits (rows.facts.json, tsc.meta),
// after two rewrites of notation: tsc's guarded reference to a name becomes the guard that Bun prints, and `void 0` becomes `undefined`.
// Also counts the cases where main (mainDesign) gives the expected value: none.
// usage: node meta-check.mjs <rows.facts.json>
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const toBun = v =>
  v
    .replace(/typeof \((_\w+) = typeof (\w+) !== "undefined" && (\2(?:\.\w+)+)\) === "function" \? \1 : Object/g, (_, a, root, path) => {
      const parts = path.split(".");
      const guards = [];
      for (let i = 1; i <= parts.length; i++) guards.push(`typeof ${parts.slice(0, i).join(".")} === "undefined"`);
      return `${guards.join(" || ")} ? Object : ${path}`;
    })
    .replace(/\bvoid 0\b/g, "undefined");
let n = 0, raw = 0, bad = 0, main = 0;
for (const r of rows) {
  if (!r.key) continue;
  n++;
  const v = new Map(r.tsc.meta ?? []).get("design:" + r.key);
  if (v === r.expected) raw++;
  if (v === undefined || toBun(v) !== r.expected) { bad++; console.log("DIFFERS", r.i, JSON.stringify(r.src), r.key, JSON.stringify(r.expected), JSON.stringify(v)); }
  if (r.mainDesign === r.expected) main++;
}
console.log(`${n} metadata cases: ${raw} whose expected value is the text tsc emits, ${n - raw - bad} more after the two rewrites, ${bad} that differ; main gives the expected value for ${main}`);
