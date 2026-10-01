// tsc 6.0.2 oracle: parse diagnostics, grammar and semantic diagnostics of the checker, and the emit of each input.
// usage: node oracle.cjs inputs.json > oracle.jsonl
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const base = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, types: [], strict: false, jsx: ts.JsxEmit.Preserve, experimentalDecorators: true, noResolve: true };
const libDir = require("path").dirname(require.resolve("/workspace/wt/parser/node_modules/typescript/lib/lib.d.ts"));
const libCache = new Map();
let old;
function check(name, text) {
  const host = {
    getSourceFile(f, lang) {
      if (f === name) return ts.createSourceFile(f, text, lang, true);
      if (!libCache.has(f)) libCache.set(f, fs.existsSync(f) ? ts.createSourceFile(f, fs.readFileSync(f, "utf8"), lang, true) : undefined);
      return libCache.get(f);
    },
    getDefaultLibFileName: o => libDir + "/" + ts.getDefaultLibFileName(o),
    writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: f => f === name || fs.existsSync(f), readFile: f => (f === name ? text : fs.readFileSync(f, "utf8")),
  };
  const program = ts.createProgram([name], base, host, old);
  old = program;
  const sf = program.getSourceFile(name);
  const fmt = d => `TS${d.code}@${d.start}`;
  return { syn: program.getSyntacticDiagnostics(sf).map(fmt), sem: program.getSemanticDiagnostics(sf).map(fmt) };
}
for (const input of inputs) {
  const name = "/" + input.id + (input.tsx ? ".tsx" : ".ts");
  const sf = ts.createSourceFile(name, input.text, ts.ScriptTarget.ESNext, true);
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  let diag = { syn: [], sem: [] };
  try { diag = check(name, input.text); } catch (e) { diag = { syn: ["THROW " + String(e.message).split("\n")[0]], sem: [] }; }
  const opts = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve };
  if (input.deco) Object.assign(opts, { experimentalDecorators: true, emitDecoratorMetadata: true });
  let emit;
  try { emit = ts.transpileModule(input.text, { compilerOptions: opts, fileName: name }).outputText; } catch (e) { emit = "THROW " + String(e.message).split("\n")[0]; }
  console.log(JSON.stringify({ id: input.id, parse, gram: diag.sem.filter(c => /^TS1\d\d\d@/.test(c)), sem: diag.sem.filter(c => !/^TS1\d\d\d@/.test(c)), emit }));
}
