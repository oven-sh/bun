const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
function dump(src, file = "t.ts") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out = [];
  const skip = new Set([K.SourceFile, K.EndOfFileToken, K.SyntaxList]);
  function walk(n, depth) {
    if (!skip.has(n.kind)) {
      let extra = "";
      if (ts.isIdentifier(n)) extra = " " + JSON.stringify(n.text);
      if (ts.isStringLiteral(n)) extra = " " + JSON.stringify(n.text);
      if (n.modifiers) extra += " mods=" + n.modifiers.map(m => K[m.kind] + "@" + m.getStart(sf) + "-" + m.end).join(",");
      if (n.isTypeOnly) extra += " typeOnly";
      if (n.kind === K.ImportClause && n.phaseModifier) extra += " phase=" + K[n.phaseModifier];
      if (n.kind === K.ModuleDeclaration) extra += " flags=" + [n.flags & ts.NodeFlags.Namespace ? "Namespace" : "", n.flags & ts.NodeFlags.GlobalAugmentation ? "GlobalAugmentation" : "", n.flags & ts.NodeFlags.NestedNamespace ? "Nested" : ""].filter(Boolean).join("|");
      if (n.flags & ts.NodeFlags.Ambient) extra += " [ambient]";
      out.push("  ".repeat(depth) + K[n.kind] + " [" + n.getStart(sf) + "," + n.end + ") pos=" + n.pos + extra);
      depth++;
    }
    ts.forEachChild(n, c => walk(c, depth));
  }
  walk(sf, 0);
  const diags = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start + "+" + d.length + " " + ts.flattenDiagnosticMessageText(d.messageText, " "));
  return { out, diags };
}
const maxDepth = +(process.env.DEPTH || 99);
for (const src of process.argv.slice(2)) {
  const { out, diags } = dump(src, process.env.FILE || "t.ts");
  console.log("=== " + JSON.stringify(src));
  for (const l of out) { if ((l.match(/^ */)[0].length / 2) < maxDepth) console.log(l); }
  for (const d of diags) console.log("  !! " + d);
}
