const ts = require("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
for (const src of process.argv.slice(2)) {
  const out = ts.transpileModule(src, { fileName: "/input.ts", reportDiagnostics: false, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false, verbatimModuleSyntax: false, strictNullChecks: false } }).outputText;
  console.log("// " + src + "\n" + out.split("\n").filter(l => l.includes("__metadata")).join("\n"));
}
