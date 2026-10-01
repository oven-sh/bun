// Compares the transliteration of typescript-go's pragma reader with TypeScript 6.0.2 (createSourceFile).
// UTF-16 offsets of tsc are converted to UTF-8 byte offsets. node pragmas-vs-tsc.cjs pragmas-inputs.json
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const { readHeader } = require("./pragmas-port.cjs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let same = 0, diff = 0;
for (const [name, source] of inputs) {
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const h = readHeader(source);
  const mode = m => (m === ts.ModuleKind.ESNext ? "ESNext" : m === ts.ModuleKind.CommonJS ? "CommonJS" : "None");
  const A = JSON.stringify({
    path: sf.referencedFiles.map(r => [r.fileName, b(r.pos), b(r.end), !!r.preserve]),
    types: sf.typeReferenceDirectives.map(r => [r.fileName, b(r.pos), b(r.end), mode(r.resolutionMode), !!r.preserve]),
    lib: sf.libReferenceDirectives.map(r => [r.fileName, b(r.pos), b(r.end), !!r.preserve]),
    check: sf.checkJsDirective ? [sf.checkJsDirective.enabled, b(sf.checkJsDirective.pos), b(sf.checkJsDirective.end)] : null,
    diags: sf.parseDiagnostics.filter(d => d.code === 1084 || d.code === 1453).map(d => [d.code, b(d.start), b(d.start + d.length)]),
    jsx: ["jsx", "jsxfrag", "jsximportsource", "jsxruntime"].map(n => { const p = sf.pragmas.get(n); const last = Array.isArray(p) ? p[p.length - 1] : p; return last ? last.arguments.factory : null; }),
  });
  const lastOf = n => { const l = h.pragmas.filter(p => p.name === n); return l.length ? l[l.length - 1].args.factory.value : null; };
  const B = JSON.stringify({
    path: h.referencedFiles.map(r => [r.fileName, r.pos, r.end, r.preserve]),
    types: h.typeReferenceDirectives.map(r => [r.fileName, r.pos, r.end, r.resolutionMode, r.preserve]),
    lib: h.libReferenceDirectives.map(r => [r.fileName, r.pos, r.end, r.preserve]),
    check: h.checkJsDirective ? [h.checkJsDirective.enabled, h.checkJsDirective.range.pos, h.checkJsDirective.range.end] : null,
    diags: h.diagnostics.map(d => [d.code, d.pos, d.end]),
    jsx: ["jsx", "jsxfrag", "jsximportsource", "jsxruntime"].map(lastOf),
  });
  if (A === B) same++; else { diff++; console.log(`DIFF ${name}\n  tsc : ${A}\n  tsgo: ${B}`); }
}
console.log(`same=${same} diff=${diff}`);
