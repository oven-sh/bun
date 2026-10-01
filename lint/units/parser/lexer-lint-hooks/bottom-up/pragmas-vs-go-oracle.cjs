// Renders pragmas-port.cjs in the format of ../top-down/pragma-expected.txt (output of the verbatim Go functions)
// and compares line by line. node pragmas-vs-go-oracle.cjs
const fs = require("fs");
const { readHeader } = require("./pragmas-port.cjs");
const inputs = JSON.parse(fs.readFileSync("../top-down/pragma-inputs.json", "utf8"));
const expected = fs.readFileSync("../top-down/pragma-expected.txt", "utf8").split("\n");
let i = 0, same = 0, diff = 0;
for (const [, source] of inputs) {
  const h = readHeader(source);
  const mode = m => (m === "ESNext" ? " mode=import" : m === "CommonJS" ? " mode=require" : "");
  const line1 = `  ref=[${h.referencedFiles.map(r => `${r.fileName}@${r.pos}-${r.end}${r.preserve ? " preserve" : ""}`).join(" ")}] types=[${h.typeReferenceDirectives.map(r => `${r.fileName}@${r.pos}-${r.end}${mode(r.resolutionMode)}${r.preserve ? " preserve" : ""}`).join(" ")}] lib=[${h.libReferenceDirectives.map(r => `${r.fileName}@${r.pos}-${r.end}${r.preserve ? " preserve" : ""}`).join(" ")}] checkJs=${h.checkJsDirective ? `enabled=${h.checkJsDirective.enabled}@${h.checkJsDirective.range.pos}-${h.checkJsDirective.range.end}` : "none"} diags=[${h.diagnostics.map(d => `TS${d.code}@${d.pos}+${d.end - d.pos}`).join(" ")}]`;
  const line2 = `  pragmas=[${h.pragmas.map(p => `${p.name}[${p.range.pos}-${p.range.end} kind=${p.range.kind === "SingleLine" ? 1 : 2} nl=${p.range.hasTrailingNewLine}]{${Object.values(p.args).sort((a, b) => (a.name < b.name ? -1 : 1)).map(a => `${a.name}=${JSON.stringify(a.value)}@${a.pos}-${a.end}`).join(",")}}`).join(" ")}]`;
  const e1 = expected[i + 1], e2 = expected[i + 2];
  if (e1 === line1 && e2 === line2) same++;
  else { diff++; console.log(`DIFF ${expected[i]}\n  go : ${e1}\n  js : ${line1}\n  go : ${e2}\n  js : ${line2}`); }
  i += 3;
}
console.log(`same=${same} diff=${diff} of ${inputs.length}`);
