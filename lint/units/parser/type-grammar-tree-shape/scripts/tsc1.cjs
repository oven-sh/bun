const ts = require("/workspace/bun/node_modules/typescript");
function diag(src) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.parseDiagnostics.map(d => `TS${d.code}@${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}
function shape(n) {
  const k = ts.SyntaxKind[n.kind];
  const kids = [];
  n.forEachChild(c => { kids.push(shape(c)); });
  if (n.kind === ts.SyntaxKind.Identifier) return n.text;
  return kids.length ? `${k}(${kids.join(", ")})` : k;
}
for (const src of process.argv.slice(2)) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  console.log(JSON.stringify(src));
  console.log("   diag:", JSON.stringify(diag(src)));
  console.log("   tree:", shape(sf.statements[0] ?? sf));
}
