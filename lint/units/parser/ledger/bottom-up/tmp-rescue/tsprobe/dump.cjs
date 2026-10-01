const ts = require("/workspace/wt/parser/node_modules/typescript");
function dump(src, opts = {}) {
  const sf = ts.createSourceFile(opts.file || "a.ts", src, ts.ScriptTarget.Latest, true);
  const out = [];
  function walk(n, depth) {
    let extra = "";
    if (n.kind === ts.SyntaxKind.Identifier) extra = " text=" + JSON.stringify(n.text);
    if (ts.isLiteralExpression(n) || ts.isTemplateLiteralToken?.(n)) extra = " text=" + JSON.stringify(n.text);
    if (n.kind === ts.SyntaxKind.TypeOperator) extra = " op=" + ts.SyntaxKind[n.operator];
    if (n.kind === ts.SyntaxKind.PrefixUnaryExpression) extra = " op=" + ts.SyntaxKind[n.operator];
    out.push("  ".repeat(depth) + ts.SyntaxKind[n.kind] + " [" + n.pos + "," + n.end + ") start=" + n.getStart(sf) + extra);
    ts.forEachChild(n, c => walk(c, depth + 1));
  }
  walk(sf, 0);
  const diags = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start + "+" + d.length + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  return { tree: out.join("\n"), diags };
}
module.exports = { dump, ts };
if (require.main === module) {
  for (const src of process.argv.slice(2)) {
    const r = dump(src);
    console.log("=== " + JSON.stringify(src));
    console.log(r.tree);
    if (r.diags.length) console.log("DIAGS: " + r.diags.join(" | "));
  }
}
