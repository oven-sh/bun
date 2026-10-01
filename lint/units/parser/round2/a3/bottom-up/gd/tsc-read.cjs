// How tsc 6.0.2 reads a source: parse diagnostics, the kinds of the statements, and what it emits as JavaScript.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const sources = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
const kind = node => ts.SyntaxKind[node.kind];
function shape(node, depth) {
  if (depth === 0) return kind(node);
  const children = [];
  node.forEachChild(child => void children.push(shape(child, depth - 1)));
  return children.length ? `${kind(node)}(${children.join(",")})` : kind(node);
}
for (const src of sources) {
  const file = ts.createSourceFile("a.ts", src, { languageVersion: ts.ScriptTarget.ESNext }, false, ts.ScriptKind.TS);
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, experimentalDecorators: true } }).outputText;
  console.log(JSON.stringify(src));
  console.log("   diagnostics:", JSON.stringify(file.parseDiagnostics.map(d => [d.code, d.start, d.length])));
  console.log("   statements: ", file.statements.map(s => shape(s, Number(process.argv[3] ?? 3))).join(" ; "));
  console.log("   emit:       ", JSON.stringify(js));
}
