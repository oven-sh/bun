// bun table.mjs <diff.jsonl>...: the table of API.md: class, cause, records, sources, one example (the shortest source).
import { readFileSync } from "node:fs";
const rows = new Map();
for (const path of process.argv.slice(2)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    const key = d.cls + "\t" + d.cause;
    if (!rows.has(key)) rows.set(key, { records: 0, sources: new Set(), ex: d.src });
    const r = rows.get(key);
    r.records++; r.sources.add(d.src);
    if (d.src.length < r.ex.length) r.ex = d.src;
  }
}
const order = ["A>R", "R>A", "A>A", "R>R"];
for (const [key, r] of [...rows].sort((a, b) => order.indexOf(a[0].split("\t")[0]) - order.indexOf(b[0].split("\t")[0]) || (a[0] < b[0] ? -1 : 1))) {
  const [cls, cause] = key.split("\t");
  console.log(`| ${cls} | ${cause} | ${r.records} | ${r.sources.size} | \`${r.ex.replaceAll("\n", "\\n").replaceAll("|", "\\|")}\` |`);
}
