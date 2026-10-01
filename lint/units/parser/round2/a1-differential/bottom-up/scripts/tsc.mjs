// node tsc.mjs [--tsx] [--legacy] <source>...   or   node tsc.mjs --file <json array of sources>
// Prints, per source: parse diagnostics and the semantic diagnostics of a one-file program (noLib).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const args = process.argv.slice(2);
const tsx = args.includes("--tsx");
const legacy = args.includes("--legacy");
const fileAt = args.indexOf("--file");
const sources = fileAt >= 0 ? JSON.parse(readFileSync(args[fileAt + 1], "utf8")) : args.filter(a => !a.startsWith("--"));
const kind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
const fileName = tsx ? "/input.tsx" : "/input.ts";
const options = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.Preserve,
  noLib: true,
  noResolve: true,
  types: [],
  ...(legacy ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {}),
};
const text = d => ts.flattenDiagnosticMessageText(d.messageText, " | ");
export function whole(src) {
  const parse = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, false, kind).parseDiagnostics;
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
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  const sf = program.getSourceFile(fileName);
  const syn = program.getSyntacticDiagnostics(sf);
  const sem = program.getSemanticDiagnostics(sf);
  return { parse, syn, sem };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const src of sources) {
    const { parse, sem } = whole(src);
    console.log(JSON.stringify(src));
    console.log("  parse:", parse.map(d => `TS${d.code}@${d.start} ${text(d)}`).join(" ; ") || "-");
    console.log("  sem:  ", sem.map(d => `TS${d.code}@${d.start} ${text(d)}`).join(" ; ") || "-");
  }
}
