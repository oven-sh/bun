// usage: node rr.mjs <diff.jsonl>   families of the R>R records: how the error list changed
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const tpl = m => m.replace(/"(?:[^"\\]|\\.)*"/g, '"…"').replace(/^Unexpected .*/, "Unexpected …").replace(/\b\d+\b/g, "N");
const fam = new Map();
const rl = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity });
let n = 0;
for await (const line of rl) {
  if (!line || !line.includes('"cls":"R>R"')) continue;
  const d = JSON.parse(line);
  if (d.cls !== "R>R") continue;
  n++;
  const b = d.base[1];
  const h = d.next[1];
  let kind;
  const sameFirst = JSON.stringify(b[0]) === JSON.stringify(h[0]);
  const bm = b.map(e => e[0]);
  const hm = h.map(e => e[0]);
  if (sameFirst) kind = h.length < b.length ? "1 same first error, fewer errors after it" : h.length > b.length ? "2 same first error, more errors after it" : "3 same first error, other errors after it";
  else if (b[0][0] === h[0][0]) kind = "4 same first message at another position";
  else if (hm.includes(bm[0]) || bm.includes(hm[0])) kind = "5 the first error of one side is a later error of the other";
  else kind = `6 another first message: ${tpl(bm[0])}  ->  ${tpl(hm[0])}`;
  if (!fam.has(kind)) fam.set(kind, { records: 0, sources: new Set(), ex: null });
  const f = fam.get(kind);
  f.records++;
  f.sources.add(d.src);
  f.ex ??= d;
}
console.log(`${n} R>R records`);
for (const [k, f] of [...fam].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  console.log(`${String(f.records).padStart(7)} records ${String(f.sources.size).padStart(6)} sources  ${k}`);
  console.log(`          e.g. ${f.ex.api} ${JSON.stringify(f.ex.src).slice(0, 90)}\n               base ${JSON.stringify(f.ex.base[1].map(e => e[0])).slice(0, 150)}\n               next ${JSON.stringify(f.ex.next[1].map(e => e[0])).slice(0, 150)}`);
}
