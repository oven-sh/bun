// node whole.mjs <x.diffsrc.jsonl> <out.jsonl> [class=R>A]
// tsc 6.0.2 as a whole for every source with a record of the class: parse diagnostics and the semantic
// diagnostics of a one-file program, as .ts and .tsx, without and with experimentalDecorators.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const [inPath, outPath, cls = "R>A"] = process.argv.slice(2);
const BASE = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.Preserve,
  noLib: true,
  noResolve: true,
  types: [],
};
const LEGACY = { ...BASE, experimentalDecorators: true, emitDecoratorMetadata: true };
const text = d => ts.flattenDiagnosticMessageText(d.messageText, " | ");
const fmt = d => [d.code, d.start ?? null, d.length ?? null, text(d)];
function whole(src, dialect, options) {
  const kind = dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const fileName = `/input.${dialect}`;
  const parse = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, false, kind).parseDiagnostics.map(fmt);
  if (parse.length > 0) return { parse };
  let file;
  const host = {
    getSourceFile: (name, lv) => (name === fileName ? (file ??= ts.createSourceFile(name, src, lv, true, kind)) : undefined),
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
  try {
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    const sf = program.getSourceFile(fileName);
    return { parse, sem: program.getSemanticDiagnostics(sf).map(fmt) };
  } catch (e) {
    return { parse, threw: String(e?.message ?? e).slice(0, 200) };
  }
}
const lines = readFileSync(inPath, "utf8").split("\n").filter(Boolean);
const out = [];
let n = 0;
for (const line of lines) {
  const s = JSON.parse(line);
  if (!s.recs.some(r => r.cls === cls)) continue;
  n++;
  const rec = { src: s.src, ctx: s.ctx, t: s.t, prod: s.prod, mut: s.mut, apis: s.recs.filter(r => r.cls === cls).map(r => r.api), base: s.recs.find(r => r.cls === cls).base };
  rec.ts = whole(s.src, "ts", BASE);
  rec.tsx = whole(s.src, "tsx", BASE);
  if (s.src.includes("@")) {
    const tsL = whole(s.src, "ts", LEGACY);
    const tsxL = whole(s.src, "tsx", LEGACY);
    if (JSON.stringify(tsL) !== JSON.stringify(rec.ts)) rec.tsL = tsL;
    if (JSON.stringify(tsxL) !== JSON.stringify(rec.tsx)) rec.tsxL = tsxL;
  }
  out.push(JSON.stringify(rec));
}
writeFileSync(outPath, out.join("\n") + "\n");
console.log(`${outPath}: ${n} sources of class ${cls}`);
