const ts = require("/workspace/wt/parser/node_modules/typescript");
function dump(node, sf, depth, out) {
  const kind = ts.SyntaxKind[node.kind];
  out.push(" ".repeat(depth*2) + kind + " [" + node.getStart(sf) + "," + node.end + ")");
  ts.forEachChild(node, c => dump(c, sf, depth+1, out));
}
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const [name, file, src] of inputs) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start + ": " + ts.flattenDiagnosticMessageText(d.messageText, " "));
  console.log("=== " + name + " :: " + JSON.stringify(src));
  console.log("diagnostics: " + (diags.length ? diags.join(" | ") : "none"));
  if (process.argv[3] === "tree") { const out = []; dump(sf, sf, 0, out); console.log(out.join("\n")); }
}
