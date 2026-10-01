// node classes.mjs <base.jsonl.gz> <head.jsonl.gz> <out prefix>
// Counts the classes of differing records and writes the distinct sources of each class.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

function load(path) {
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  const records = new Map();
  for (let i = 1; i < lines.length; i++) {
    const r = JSON.parse(lines[i]);
    records.set(r.src, r);
  }
  return { header, records, count: lines.length - 1 };
}
const [basePath, headPath, prefix] = process.argv.slice(2);
const base = load(basePath);
const head = load(headPath);
const valueOf = (run, record, api) => {
  if (record === undefined) return ["missing"];
  if (record.crash !== undefined) return [record.crash === "hang" ? "hang" : "crash", record.crash];
  const at = run.header.apis.indexOf(api);
  return at < 0 ? ["missing"] : record.vals[record.res[at]];
};
const kind = v => (v[0] === "e" ? "R" : v[0] === "o" || v[0] === "s" || v[0] === "i" ? "A" : v[0]);
const apis = base.header.apis;
const byClass = new Map();
const bySrc = new Map();
let compared = 0;
let differing = 0;
for (const src of new Set([...base.records.keys(), ...head.records.keys()])) {
  const b = base.records.get(src);
  const n = head.records.get(src);
  for (const api of apis) {
    compared++;
    const bv = valueOf(base, b, api);
    const nv = valueOf(head, n, api);
    if (JSON.stringify(bv) === JSON.stringify(nv)) continue;
    differing++;
    const cls = `${kind(bv)}>${kind(nv)}`;
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    if (!bySrc.has(src)) bySrc.set(src, { src, ctx: (b ?? n).ctx, t: (b ?? n).t, prod: (b ?? n).prod, mut: (b ?? n).mut, recs: [] });
    bySrc.get(src).recs.push({ api, cls, base: bv, head: nv });
  }
}
console.log(`base ${base.header.version} ${base.header.revision} lines=${base.count} distinct=${base.records.size}`);
console.log(`head ${head.header.version} ${head.header.revision} lines=${head.count} distinct=${head.records.size}`);
console.log(`${compared} records compared, ${differing} differ, in ${bySrc.size} sources`);
for (const [cls, n] of [...byClass].sort()) {
  const sources = [...bySrc.values()].filter(s => s.recs.some(r => r.cls === cls)).length;
  console.log(`  ${cls.padEnd(8)} ${String(n).padStart(8)} records ${String(sources).padStart(7)} sources`);
}
writeFileSync(`${prefix}.diffsrc.jsonl`, [...bySrc.values()].map(s => JSON.stringify(s)).join("\n") + "\n");
