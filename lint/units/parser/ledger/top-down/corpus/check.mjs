// Phase 2 of the classifier: what the checker and the emitter of tsc say about the rows of class A.
//
//   bun check.mjs <out dir>
//
// Reads  <out>/a-rows.jsonl (join.mjs).
// Writes <out>/a-check.jsonl  {"id","dialect","codes":[[code, message of its first report], ...],
//                              "decoCodes": the same with experimentalDecorators + emitDecoratorMetadata,
//                              only when the set of codes differs, "names": every name that a diagnostic of an
//                              unresolved name quotes (TS2304, TS2503, TS2552), "threw": text when the program threw}
//        <out>/a-emit.jsonl   {"id","src": the JavaScript that ts.transpileModule prints} (input of bun-side.mjs,
//                              configurations js and jsx)
// The program has one file and no library (noLib, noResolve), so the checker reports unresolved names and
// missing global types beside the rules of the grammar. Every code is kept: the report applies both class
// definitions to this list.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const TS_PATH = process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(TS_PATH);
const [outDir] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: bun check.mjs <out dir>");
  process.exit(1);
}
const rows = readFileSync(join(outDir, "a-rows.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map(l => JSON.parse(l));

function programCodes(src, dialect, deco) {
  const fileName = dialect === "tsx" ? "/input.tsx" : "/input.ts";
  const kind = dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    noResolve: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    experimentalDecorators: deco,
    emitDecoratorMetadata: deco,
  };
  const host = {
    getSourceFile: (name, o) => (name === fileName ? ts.createSourceFile(name, src, o, true, kind) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile() {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: f => f === fileName,
    readFile: f => (f === fileName ? src : undefined),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const sf = program.getSourceFile(fileName);
  const all = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const seen = new Map();
  const names = new Set();
  for (const d of all) {
    const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (!seen.has(d.code)) seen.set(d.code, text.slice(0, 160));
    if (d.code === 2304 || d.code === 2503 || d.code === 2552) {
      const m = /'([^']*)'/.exec(text);
      if (m) names.add(m[1]);
    }
  }
  return { codes: [...seen].sort((a, b) => a[0] - b[0]), names: [...names] };
}

function emit(src, dialect, deco) {
  return ts.transpileModule(src, {
    fileName: dialect === "tsx" ? "input.tsx" : "input.ts",
    reportDiagnostics: false,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      useDefineForClassFields: true,
      experimentalDecorators: deco,
      emitDecoratorMetadata: deco,
      verbatimModuleSyntax: false,
    },
  }).outputText;
}

const checks = [];
const emits = [];
let threw = 0;
for (const r of rows) {
  const out = { id: r.id, dialect: r.dialect };
  try {
    const plain = programCodes(r.src, r.dialect, false);
    out.codes = plain.codes;
    if (plain.names.length) out.names = plain.names;
    const deco = programCodes(r.src, r.dialect, true).codes;
    if (JSON.stringify(deco.map(c => c[0])) !== JSON.stringify(out.codes.map(c => c[0]))) out.decoCodes = deco;
  } catch (e) {
    out.codes = out.codes ?? [];
    out.threw = String(e?.message ?? e).slice(0, 160);
    threw++;
  }
  checks.push(JSON.stringify(out));
  let js;
  try {
    js = emit(r.src, r.dialect, r.deco);
  } catch (e) {
    js = null;
    out.emitThrew = String(e?.message ?? e).slice(0, 160);
    checks[checks.length - 1] = JSON.stringify(out);
  }
  if (js !== null) emits.push(JSON.stringify({ id: r.id, src: js }));
}
writeFileSync(join(outDir, "a-check.jsonl"), checks.join("\n") + "\n");
writeFileSync(join(outDir, "a-emit.jsonl"), emits.join("\n") + "\n");
console.log(`checker pass: ${rows.length} rows, ${threw} programs threw, ${emits.length} emits`);
