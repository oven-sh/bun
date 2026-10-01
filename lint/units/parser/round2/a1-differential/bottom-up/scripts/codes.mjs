// node codes.mjs <x.ra-whole.jsonl>... : per tsc code, the R>A records and sources that carry it.
import { readFileSync } from "node:fs";
const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
const show = Number(process.argv.find(a => a.startsWith("--show="))?.slice(7) ?? 3);
const dialect = api => (api.includes(".tsx.") ? "tsx" : "ts");
const legacy = api => /\.(exp|deco)\b/.test(api);
const parseCodes = new Map();
const semCodes = new Map();
let clean = { records: 0, sources: new Set() };
let records = 0;
const sources = new Set();
const add = (map, code, src, msg) => {
  if (!map.has(code)) map.set(code, { records: 0, sources: new Set(), msg });
  const e = map.get(code);
  e.records++;
  e.sources.add(src);
};
for (const file of files) {
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    sources.add(r.src);
    for (const api of r.apis) {
      records++;
      const key = dialect(api);
      const w = (legacy(api) ? r[key + "L"] : undefined) ?? r[key];
      if (w.parse.length > 0) {
        for (const code of new Set(w.parse.map(d => d[0]))) add(parseCodes, code, r.src, w.parse.find(d => d[0] === code)[3]);
        continue;
      }
      if (w.threw) {
        add(semCodes, "threw", r.src, w.threw);
        continue;
      }
      if (w.sem.length === 0) {
        clean.records++;
        clean.sources.add(r.src);
        continue;
      }
      for (const code of new Set(w.sem.map(d => d[0]))) add(semCodes, code, r.src, w.sem.find(d => d[0] === code)[3]);
    }
  }
}
console.log(`${records} R>A records in ${sources.size} sources`);
console.log(`tsc as a whole reports nothing: ${clean.records} records, ${clean.sources.size} sources`);
const print = (title, map) => {
  console.log(title);
  for (const [code, e] of [...map].sort((a, b) => (a[0] > b[0] ? 1 : -1))) {
    console.log(`  TS${code}  ${String(e.records).padStart(6)} records ${String(e.sources.size).padStart(5)} sources  ${e.msg.slice(0, 110)}`);
    let i = 0;
    for (const s of e.sources) {
      if (i++ >= show) break;
      console.log(`        ${JSON.stringify(s).slice(0, 160)}`);
    }
  }
};
print("PARSE diagnostics (tsc's parser rejects):", parseCodes);
print("SEMANTIC diagnostics (a record counts under every code it has):", semCodes);
