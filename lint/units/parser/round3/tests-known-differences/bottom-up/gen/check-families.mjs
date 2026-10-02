// usage: node check-families.mjs   the rows of each family, with its classes and its route
import { readFileSync } from "node:fs";
import { FAMILIES, familyOf } from "./families.mjs";
const rows = JSON.parse(readFileSync(new URL("../rows.facts.json", import.meta.url), "utf8"));
const by = {};
for (const r of rows) {
  const f = familyOf(r);
  by[f] ??= { rows: 0, src: new Set(), cls: new Set(), valid: 0 };
  by[f].rows++;
  by[f].src.add(r.loader + "|" + r.src);
  by[f].cls.add(r.class);
  if (r.valid) by[f].valid++;
}
let n = 0;
console.log("rows sources valid class     route       family");
for (const [f, v] of Object.entries(by)) {
  n += v.rows;
  console.log(String(v.rows).padStart(4), String(v.src.size).padStart(7), String(v.valid).padStart(5), [...v.cls].join(",").padEnd(9), FAMILIES[f].route.padEnd(11), f);
}
console.log(n, "rows");
