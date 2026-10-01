// node tsc2.mjs <ambient text> <source>... : semantic diagnostics of /input.ts in a program with /ambient.d.ts
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const [ambient, ...sources] = process.argv.slice(2);
const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, moduleDetection: ts.ModuleDetectionKind.Force, jsx: ts.JsxEmit.Preserve, noLib: true, types: [], strict: true };
const text = d => ts.flattenDiagnosticMessageText(d.messageText, " | ");
for (const src of sources) {
  const files = { "/input.ts": src, "/ambient.d.ts": ambient };
  const host = {
    getSourceFile: (name, lv) => (files[name] !== undefined ? ts.createSourceFile(name, files[name], lv, true) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => files[f] !== undefined, readFile: f => files[f],
    directoryExists: () => true, getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: ["/ambient.d.ts", "/input.ts"], options, host });
  const sf = program.getSourceFile("/input.ts");
  const all = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf), ...program.getSemanticDiagnostics(program.getSourceFile("/ambient.d.ts")).map(d => ({ ...d, code: "amb" + d.code }))];
  console.log(JSON.stringify(src));
  console.log("   ", all.map(d => `TS${d.code}@${d.start} ${text(d)}`).join(" ; ") || "-");
}
