// Streams diff.<corpus>.jsonl: per class, the sources, and what tsc's parser says of each for the loader of the api.
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const path = process.argv[2];
const classes = new Map();
const loaderOf = api => (api.includes(".tsx.") ? "tsx" : "ts");
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!line) continue;
  const d = JSON.parse(line);
  let m = classes.get(d.cls);
  if (!m) classes.set(d.cls, (m = { records: 0, sources: new Map() }));
  m.records++;
  let s = m.sources.get(d.src);
  if (!s) m.sources.set(d.src, (s = { apis: [], base: d.base, next: d.next, tsc: d.tsc, tscValid: 0, tscInvalid: 0, ctx: d.ctx, prod: d.prod, mut: d.mut, t: d.t }));
  s.apis.push(d.api);
  const diags = d.tsc ? d.tsc[loaderOf(d.api)] : undefined;
  if (diags === undefined) s.noOracle = true;
  else if (diags.length === 0) s.tscValid++;
  else s.tscInvalid++;
}
const out = {};
for (const [cls, m] of classes) {
  let valid = 0, invalid = 0, mixed = 0, none = 0;
  const validList = [];
  for (const [src, s] of m.sources) {
    if (s.noOracle) none++;
    else if (s.tscValid && s.tscInvalid) { mixed++; validList.push([src, s]); }
    else if (s.tscValid) { valid++; validList.push([src, s]); }
    else invalid++;
  }
  console.log(`== ${cls}: ${m.records} records in ${m.sources.size} sources; tsc parser: every api invalid ${invalid}, every api valid ${valid}, valid for one loader ${mixed}, no oracle ${none}`);
  out[cls] = validList.map(([src, s]) => ({ src, apis: s.apis, base: s.base, next: s.next, tsc: s.tsc, prod: s.prod, mut: s.mut, ctx: s.ctx, t: s.t }));
  if (cls === "A>A") out["A>A all"] = [...m.sources].map(([src, s]) => ({ src, apis: s.apis, base: s.base, next: s.next, tsc: s.tsc, prod: s.prod, mut: s.mut, ctx: s.ctx, t: s.t }));
}
writeFileSync(process.argv[3], JSON.stringify(out));
