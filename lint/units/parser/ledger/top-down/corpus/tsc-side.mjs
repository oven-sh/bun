// What the parser of tsc says about every source of a corpus. Independent of the bun binary that runs it.
//
//   bun tsc-side.mjs <corpus.jsonl> <out.jsonl.gz>
//
// Output, gzip, one JSON value per line:
//   line 1    {"header":1,"typescript":"6.0.2","count"}
//   line 2..  {"id","ts":[n, [[code,start,length,message], ... at most 4]],"tsx":"=" or the same shape,
//              "dts": the same shape, only for a record with "dts": true, "=" when equal to "ts"}
// n is the number of parseDiagnostics of ts.createSourceFile(input.ts | input.tsx | input.d.ts, ESNext).
// A parse that throws (stack overflow of tsc on deep nesting) is recorded as [-1, [[0, 0, 0, text]]].
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";

const TS_PATH = process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(TS_PATH);
const [corpusPath, outPath] = process.argv.slice(2);
if (!corpusPath || !outPath) {
  console.error("usage: bun tsc-side.mjs <corpus.jsonl> <out.jsonl.gz>");
  process.exit(1);
}
const fmt = d => [d.code, d.start ?? null, d.length ?? null, ts.flattenDiagnosticMessageText(d.messageText, "\n")];
const parse = (src, name, kind) => {
  try {
    const ds = ts.createSourceFile(name, src, ts.ScriptTarget.ESNext, false, kind).parseDiagnostics;
    return [ds.length, ds.slice(0, 4).map(fmt)];
  } catch (e) {
    return [-1, [[0, 0, 0, String(e?.message ?? e).slice(0, 120)]]];
  }
};
const lines = [JSON.stringify({ header: 1, typescript: ts.version, count: 0 })];
let count = 0;
for (const line of readFileSync(corpusPath, "utf8").split("\n")) {
  if (!line) continue;
  const rec = JSON.parse(line);
  const a = parse(rec.src, "/input.ts", ts.ScriptKind.TS);
  const b = parse(rec.src, "/input.tsx", ts.ScriptKind.TSX);
  const out = { id: rec.id, ts: a, tsx: JSON.stringify(a) === JSON.stringify(b) ? "=" : b };
  if (rec.dts) {
    const c = parse(rec.src, "/input.d.ts", ts.ScriptKind.TS);
    out.dts = JSON.stringify(a) === JSON.stringify(c) ? "=" : c;
  }
  lines.push(JSON.stringify(out));
  count++;
}
lines[0] = JSON.stringify({ header: 1, typescript: ts.version, count });
writeFileSync(outPath, gzipSync(lines.join("\n") + "\n"));
console.log(`tsc ${ts.version}: ${count} sources`);
