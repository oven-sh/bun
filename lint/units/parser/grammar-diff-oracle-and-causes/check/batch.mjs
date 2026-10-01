// Scratch: bun batch.mjs <corpus.json> <out.jsonl.gz> [shard shards]
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadTs, makeChecker } from "./tsgrammar.mjs";
import { expand } from "/workspace/notes/lint/units/parser/grammar-diff/harness.mjs";
const [corpusPath, outPath, shard = "0", shards = "1"] = process.argv.slice(2);
const ts = loadTs(true);
const semantic = makeChecker(ts);
const inputs = expand(JSON.parse(readFileSync(corpusPath, "utf8")));
const parse = (src, dialect) => ts.createSourceFile("/input." + dialect, src, ts.ScriptTarget.ESNext, false, dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length;
const lines = [];
let programs = 0;
const t0 = performance.now();
for (let i = 0; i < inputs.length; i++) {
  if (i % Number(shards) !== Number(shard)) continue;
  const src = inputs[i].src;
  const rec = { i, src, c: {} };
  for (const dialect of ["ts", "tsx"]) {
    if (parse(src, dialect) !== 0) continue;
    for (const legacy of src.includes("@") ? [false, true] : [false]) {
      let r;
      try {
        r = semantic(src, dialect, legacy);
      } catch (e) {
        rec.c[dialect + (legacy ? "L" : "")] = { threw: String(e?.message ?? e).slice(0, 200) };
        continue;
      }
      programs++;
      rec.c[dialect + (legacy ? "L" : "")] = { sem: r.sem.map(d => (d[0] === 2304 || d[0] === 2300 ? d : [d[0], d[1], d[2]])), gi: r.gi, bind: r.bind };
    }
  }
  lines.push(JSON.stringify(rec));
}
writeFileSync(outPath, gzipSync(lines.join("\n") + "\n"));
console.log(`${outPath}: ${lines.length} sources, ${programs} programs, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
