// usage: node tsc-checkjs.mjs <typescript.js> : do the syntactic diagnostics of a JavaScript file depend on checkJs or on a pragma?
import { inputs } from "./inputs.mjs";
const ts = (await import(process.argv[2])).default;
function syn(code, checkJs, name = "/a.js") {
  const sf = ts.createSourceFile(name, code, ts.ScriptTarget.ESNext, true);
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, checkJs, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, jsx: ts.JsxEmit.Preserve };
  const host = { getSourceFile: f => (f === name ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === name, readFile: () => undefined };
  const program = ts.createProgram([name], options, host);
  return { syn: program.getSyntacticDiagnostics(sf).map(d => `TS${d.code}@${d.start}+${d.length}`).join(","), directive: sf.checkJsDirective ? `${sf.checkJsDirective.enabled}@${sf.checkJsDirective.pos}-${sf.checkJsDirective.end}` : "none", refs: sf.referencedFiles.length + "/" + sf.typeReferenceDirectives.length };
}
let differ = 0;
for (const [id, code] of inputs) { const a = syn(code, false), b = syn(code, true), c = syn("// @ts-check\n" + code, false), d = syn("// @ts-nocheck\n" + code, true);
  const shift = s => s; if (a.syn !== b.syn) { differ++; console.log("checkJs changes", id, a.syn, "|", b.syn); } }
console.log("inputs", inputs.length, "syntactic diagnostics that depend on checkJs:", differ);
for (const code of ["// @ts-check\nvar x;", "// @ts-nocheck\nvar x;", "/* @ts-check */\nvar x;", "#!/usr/bin/env node\n// @ts-check\nvar x;", "var x;\n// @ts-check", "// @ts-check\n// @ts-nocheck\nvar x;", "'use strict';\n// @ts-check\nvar x;", "/** @ts-check */ var x", "//@ts-check\nvar x", "//   @ts-nocheck   trailing words\nvar x", "// @TS-CHECK\nvar x", "/// <reference path='a.d.ts' />\n// @ts-check\nvar x"]) {
  console.log(JSON.stringify(code).padEnd(60), "js:", JSON.stringify(syn(code, false)), " ts:", JSON.stringify(syn(code, false, "/a.ts")));
}
