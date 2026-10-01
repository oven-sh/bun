// usage: node broad.mjs <diff.jsonl>   the R>A records that no RESTORE entry owns, by the codes of syntactic form that tsc reports through error()
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const FORM = new Set([2369, 2371, 2499, 2500, 1540, 1102, 1228, 2680, 2681]);
const byCause = new Map();
const rl = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || !line.includes('"cls":"R>A"')) continue;
  const d = JSON.parse(line);
  if (d.cls !== "R>A" || /^RESTORE/.test(d.cause)) continue;
  const dialect = d.api.includes(".tsx.") ? "tsx" : "ts";
  const codes = (d.tsc?.oth?.[dialect] ?? []).filter(c => FORM.has(c));
  const key = `${d.cause}\t${codes.length ? codes.map(c => "TS" + c).join(",") : "none"}`;
  if (!byCause.has(key)) byCause.set(key, { records: 0, sources: new Set(), ex: d.src });
  const r = byCause.get(key);
  r.records++;
  r.sources.add(d.src);
}
let restore = 0, restoreSrc = new Set(), keep = 0;
for (const [k, r] of [...byCause].sort()) {
  const [cause, codes] = k.split("\t");
  console.log(`${String(r.records).padStart(6)} records ${String(r.sources.size).padStart(4)} sources  ${codes.padEnd(14)} ${cause.slice(0, 86)}   e.g. ${JSON.stringify(r.ex).slice(0, 60)}`);
  if (codes !== "none") { restore += r.records; for (const s of r.sources) restoreSrc.add(s); } else keep += r.records;
}
console.log(`${restore} records in ${restoreSrc.size} sources carry such a code; ${keep} records carry none`);
