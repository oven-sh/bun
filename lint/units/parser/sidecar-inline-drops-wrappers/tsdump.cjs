// Dumps the tsc 6.0.2 tree of each input: kind [start,end) with start = getStart (token start), pos = full start.
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const inputs = process.argv.slice(2).length ? process.argv.slice(2) : require("./inputs.json");
function dump(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const out = [];
  const skip = new Set([ts.SyntaxKind.SourceFile, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.SyntaxList]);
  function walk(n, depth) {
    if (!skip.has(n.kind)) {
      let extra = "";
      if (ts.isIdentifier(n)) extra = " " + JSON.stringify(n.text);
      if (n.modifiers) extra += " mods=" + n.modifiers.map(m => ts.SyntaxKind[m.kind] + "@" + m.getStart(sf) + "-" + m.end).join(",");
      if (n.questionToken) extra += " ?@" + n.questionToken.getStart(sf);
      if (n.exclamationToken) extra += " !@" + n.exclamationToken.getStart(sf);
      if (n.isTypeOnly) extra += " typeOnly";
      if (n.flags & ts.NodeFlags.OptionalChain) extra += " [chain]";
      out.push("  ".repeat(depth) + ts.SyntaxKind[n.kind] + " [" + n.getStart(sf) + "," + n.end + ") pos=" + n.pos + extra);
      depth++;
    }
    ts.forEachChild(n, c => walk(c, depth));
  }
  walk(sf, 0);
  const diags = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start + "+" + d.length + " " + ts.flattenDiagnosticMessageText(d.messageText, " "));
  return { out, diags };
}
for (const item of inputs) {
  const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
  const { out, diags } = dump(src, file);
  console.log("=== " + file + " :: " + JSON.stringify(src));
  for (const l of out) console.log(l);
  for (const d of diags) console.log("  !! " + d);
}
