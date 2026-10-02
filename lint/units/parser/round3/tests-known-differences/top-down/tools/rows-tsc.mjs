// usage: node rows-tsc.mjs <testrows.json> <out.json>   what tsc 6.0.2 says about every row
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { check, parseAs, metadataOf, GRAMMAR_CODES } from "./gd/oracle.mjs";
import { tagOf } from "./probes/metadata.mjs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fmt = d => [d.code, d.start ?? null, d.length ?? null, ts.flattenDiagnosticMessageText(d.messageText, "\n")];
function parseJs(src) {
  return ts.createSourceFile("/input.js", src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS).parseDiagnostics.map(fmt);
}
function emit(src, fileName, extra) {
  return ts.transpileModule(src, {
    fileName,
    reportDiagnostics: false,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, useDefineForClassFields: false, verbatimModuleSyntax: false, jsx: ts.JsxEmit.Preserve, ...extra },
  }).outputText;
}
const out = rows.map(r => {
  const dialect = r.loader === "tsx" ? "tsx" : r.loader === "js" ? "js" : "ts";
  const legacy = r.loader === "deco";
  const rec = { dialect };
  rec.parse = dialect === "js" ? parseJs(r.src) : parseAs(r.src, dialect);
  if (rec.parse.length === 0 && dialect !== "js") {
    const c = check(r.src, dialect, legacy);
    rec.chk = c.grammar;
    rec.oth = c.other;
  } else {
    rec.chk = null;
    rec.oth = null;
  }
  rec.valid = rec.parse.length === 0 && (rec.chk === null ? dialect === "js" : rec.chk.length === 0);
  if (rec.parse.length === 0) {
    try {
      if (legacy) {
        const loose = emit(r.src, "/input.ts", { experimentalDecorators: true, emitDecoratorMetadata: true, strictNullChecks: false });
        const strict = emit(r.src, "/input.ts", { experimentalDecorators: true, emitDecoratorMetadata: true });
        rec.metaLoose = metadataOf(loose);
        rec.metaStrict = metadataOf(strict);
        rec.emit = loose;
      } else {
        rec.emit = emit(r.src, `/input.${dialect}`, {});
      }
    } catch (e) {
      rec.emitThrew = String(e?.message ?? e).slice(0, 200);
    }
  }
  if (r.key) {
    const pick = list => (list ?? []).find(([k]) => k === "design:" + r.key)?.[1] ?? null;
    rec.tscValue = pick(rec.metaLoose);
    rec.tscValueStrict = pick(rec.metaStrict);
    rec.tscTag = rec.tscValue === null ? null : tagOf(rec.tscValue);
    rec.tscTagStrict = rec.tscValueStrict === null ? null : tagOf(rec.tscValueStrict);
    rec.expectedTag = tagOf(r.expected);
  }
  return { ...r, tsc: rec };
});
writeFileSync(process.argv[3], JSON.stringify(out));
let valid = 0, parseErr = 0, chkErr = 0;
for (const r of out) { if (r.tsc.valid) valid++; else if (r.tsc.parse.length) parseErr++; else chkErr++; }
console.log(ts.version, { rows: out.length, valid, parseErr, chkErr });
