const ts = require("/workspace/wt/parser/node_modules/typescript");
const cases = [
  `declare const dec: any; declare const a: any, b: any, d: any;\nconst x = a ? (b) : c => { class K { @dec p: Foo } return K } : d;`,
  `declare const dec: any; declare const a: any, b: any, d: any;\nconst x = a ? (b) : c => { class K { @dec p: Foo } return K };`,
];
for (const text of cases) {
  const sf = ts.createSourceFile("a.ts", text, 99, true);
  console.log("parse diagnostics:", sf.parseDiagnostics.map(d => "TS" + d.code + " " + ts.flattenDiagnosticMessageText(d.messageText, " ")).join(" | ") || "-");
  const out = ts.transpileModule(text, { compilerOptions: { target: 99, module: 99, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
  console.log(out.split("\n").filter(l => /design:type|const x|class K/.test(l)).join("\n"));
  console.log("----");
}
