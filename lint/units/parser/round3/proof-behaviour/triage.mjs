// Groups the differing records of one diff file of run-proof.sh by class and by the first message on each side.
// usage: bun triage.mjs <OUT>/<tag>/<harness>.<corpus>.diff.jsonl [rows, default 40]
import { readFileSync } from "node:fs";
const [path, rows = "40"] = process.argv.slice(2);
const first = v => (v[0] === "e" ? String(v[1][0]?.[0]) : v[0] === "o" || v[0] === "s" || v[0] === "i" ? "accepts" : v.join(" "));
const groups = new Map();
let total = 0;
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  total++;
  const key = `${d.cls} | ${first(d.base)} -> ${first(d.next)}`;
  const g = groups.get(key) ?? { count: 0, sources: new Set(), apis: new Set(), example: d.src };
  g.count++;
  g.sources.add(d.src);
  g.apis.add(d.api);
  groups.set(key, g);
}
console.log(`${total} differing records, ${groups.size} groups`);
for (const [key, g] of [...groups].sort((a, b) => b[1].count - a[1].count).slice(0, Number(rows)))
  console.log(`${String(g.count).padStart(8)} records ${String(g.sources.size).padStart(6)} sources ${String(g.apis.size).padStart(2)} apis  ${key}   e.g. ${JSON.stringify(g.example).slice(0, 120)}`);
