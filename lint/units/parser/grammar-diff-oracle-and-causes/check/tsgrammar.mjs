// Scratch prototype: the checker diagnostics of tsc 6.0.2 for one source, one program per (dialect, decorator mode).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const TS_PATH = process.env.ORACLE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";

// Loads typescript.js; with instrument=true a copy whose grammarError* functions log the code they report.
export function loadTs(instrument) {
  if (!instrument) return createRequire(import.meta.url)(TS_PATH);
  let text = readFileSync(TS_PATH, "utf8");
  let patched = 0;
  for (const name of ["grammarErrorOnFirstToken", "grammarErrorAtPos", "grammarErrorOnNodeSkippedOn", "grammarErrorOnNode", "grammarErrorAfterFirstToken"]) {
    const at = text.indexOf(`\n  function ${name}(`);
    if (at < 0) throw new Error("no " + name);
    const needle = "if (!hasParseDiagnostics(sourceFile)) {";
    const k = text.indexOf(needle, at);
    if (k < 0 || k - at > 400) throw new Error("no guard in " + name);
    text = text.slice(0, k + needle.length) + " globalThis.__G.push(message.code);" + text.slice(k + needle.length);
    patched++;
  }
  // The regular expression scanner of the checker reports through diagnostics.add(lastError).
  const re = "lastError = createFileDiagnostic(sourceFile, start, length2, message, arg0);\n          diagnostics.add(lastError);";
  const r = text.indexOf(re);
  if (r < 0) throw new Error("no regexp site");
  text = text.slice(0, r + re.length) + " globalThis.__G.push(message.code);" + text.slice(r + re.length);
  globalThis.__G = [];
  const module = { exports: {} };
  const fn = vm.runInThisContext(`(function (module, exports, require, __filename, __dirname) {${text}\n})`, { filename: "/tmp/gdo/typescript.instrumented.js" });
  fn(module, module.exports, createRequire(TS_PATH), TS_PATH, TS_PATH.replace(/\/[^/]*$/, ""));
  return module.exports;
}

export function makeChecker(ts) {
  const base = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    types: [],
    useDefineForClassFields: false,
    verbatimModuleSyntax: false,
  };
  const LEGACY = { experimentalDecorators: true, emitDecoratorMetadata: true };
  // All semantic diagnostics of the one file of a program, as [code, start, length, text].
  return function semantic(src, dialect, legacy) {
    const fileName = dialect === "tsx" ? "/input.tsx" : "/input.ts";
    const options = legacy ? { ...base, ...LEGACY } : base;
    let file;
    const host = {
      getSourceFile: (name, languageVersionOrOptions) => (name === fileName ? (file ??= ts.createSourceFile(name, src, languageVersionOrOptions, true, dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS)) : undefined),
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
    if (globalThis.__G) globalThis.__G.length = 0;
    const sem = program.getSemanticDiagnostics(sf).map(d => [d.code, d.start ?? null, d.length ?? null, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
    const syn = program.getSyntacticDiagnostics(sf).map(d => d.code);
    const bind = (sf.bindDiagnostics ?? []).map(d => d.code);
    return { sem, syn, bind, gi: globalThis.__G ? [...globalThis.__G] : null };
  };
}
