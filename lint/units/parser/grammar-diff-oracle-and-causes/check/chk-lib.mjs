// Scratch: the functions of oracle.proposed.mjs as a module.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
export const ts = createRequire(import.meta.url)("/workspace/bun/node_modules/typescript/lib/typescript.js");
const f = JSON.parse(readFileSync("/tmp/gdo/final-codes.json", "utf8"));
export const GRAMMAR_CODES = new Set([...f.grammarchecks, ...f.elsewhere, ...f.more]);
const text = d => ts.flattenDiagnosticMessageText(d.messageText, "\n");
const isGrammarError = d => GRAMMAR_CODES.has(d.code) && (d.code !== 2304 || /^Cannot find name '#/.test(text(d)));
const CHECK_OPTIONS = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, moduleDetection: ts.ModuleDetectionKind.Force, jsx: ts.JsxEmit.Preserve, noLib: true, noResolve: true, types: [] };
const LEGACY = { ...CHECK_OPTIONS, experimentalDecorators: true, emitDecoratorMetadata: true };
export const parseCodes = (src, dialect) => ts.createSourceFile("/input." + dialect, src, ts.ScriptTarget.ESNext, false, dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.map(d => d.code);
export function semantic(src, dialect, legacy) {
  const fileName = "/input." + dialect;
  const kind = dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  let file;
  const host = {
    getSourceFile: (name, o) => (name === fileName ? (file ??= ts.createSourceFile(name, src, o, true, kind)) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: x => x, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: x => x === fileName, readFile: x => (x === fileName ? src : undefined), directoryExists: () => true, getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [fileName], options: legacy ? LEGACY : CHECK_OPTIONS, host });
  return program.getSemanticDiagnostics(program.getSourceFile(fileName));
}
export const grammarOf = (src, dialect, legacy) => semantic(src, dialect, legacy).filter(isGrammarError).map(d => [d.code, d.start, d.length, text(d)]);
export const otherOf = (src, dialect, legacy) => [...new Set(semantic(src, dialect, legacy).filter(d => !isGrammarError(d)).map(d => d.code))].sort((a, b) => a - b);
