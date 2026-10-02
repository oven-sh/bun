// What tsc 6.0.2 says of every row: parse diagnostics in the dialect of the row, grammar errors of its checker,
// the other codes, and for a row with a metadata key the value it emits (strictNullChecks off, as the rows say).
// usage: node tsc-rows.mjs rows.json <out.json>     GD=<dir with grammar-diff/ and for-grammar-diff/ merged>, see run.sh
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const GD = process.env.GD ?? "/tmp/tkd/gd";
const { recordOf, check, metadataOf } = await import(GD + "/oracle.mjs");
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fmt = d => [d.code, d.start ?? null, d.length ?? null, ts.flattenDiagnosticMessageText(d.messageText, "\n")];
const emit = (src, fileName, extra) =>
  ts.transpileModule(src, { fileName, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, useDefineForClassFields: false, verbatimModuleSyntax: false, jsx: ts.JsxEmit.Preserve, ...extra } }).outputText;
const cache = new Map();
const out = rows.map(r => {
  const dialect = r.loader === "tsx" ? "tsx" : r.loader === "js" ? "js" : "ts";
  const legacy = r.loader === "deco";
  const key = dialect + "\0" + legacy + "\0" + r.src;
  let v = cache.get(key);
  if (!v) {
    v = {};
    if (dialect === "js") {
      v.parse = ts.createSourceFile("/input.js", r.src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS).parseDiagnostics.map(fmt);
      v.chk = [];
      v.oth = [];
    } else {
      v.parse = recordOf(r.src)[dialect];
      if (v.parse.length === 0) {
        const c = check(r.src, dialect, legacy);
        v.chk = c.grammar;
        v.oth = c.other;
      } else {
        v.chk = null;
        v.oth = null;
      }
      if (legacy) v.meta = metadataOf(emit(r.src, "/input.ts", { experimentalDecorators: true, emitDecoratorMetadata: true, strictNullChecks: false }));
    }
    cache.set(key, v);
  }
  return v;
});
writeFileSync(process.argv[3], JSON.stringify({ version: ts.version, rows: out }));
const clean = out.filter(v => v.parse.length === 0).length;
const valid = out.filter(v => v.parse.length === 0 && v.chk.length === 0).length;
console.log(`typescript ${ts.version}: ${out.length} rows, ${clean} parse without a diagnostic, ${valid} of them without a grammar error of the checker`);
