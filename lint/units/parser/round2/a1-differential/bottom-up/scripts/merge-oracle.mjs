// node merge-oracle.mjs <committed oracle.jsonl.gz> <x.diffsrc.jsonl> <out.jsonl.gz>
// The committed oracle, with chk and oth (the candidate oracle's fields) for every source with a differing record.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { recordOf } from "./oracle.mjs";
const [oraclePath, diffPath, outPath] = process.argv.slice(2);
const lines = gunzipSync(readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean);
const want = new Set(readFileSync(diffPath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).src));
const out = [lines[0]];
let n = 0;
for (let i = 1; i < lines.length; i++) {
  const r = JSON.parse(lines[i]);
  if (want.has(r.src)) {
    out.push(JSON.stringify(recordOf(r.src)));
    n++;
  } else out.push(lines[i]);
}
writeFileSync(outPath, gzipSync(out.join("\n") + "\n"));
console.log(`${outPath}: ${lines.length - 1} records, ${n} with chk`);
