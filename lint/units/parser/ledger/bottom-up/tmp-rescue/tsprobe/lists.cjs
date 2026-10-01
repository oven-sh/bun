const ts = require("/workspace/wt/parser/node_modules/typescript");
function dump(src) {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  const out = [];
  function walk(n, depth) {
    const lists = [];
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v) && typeof v.pos === "number" && k !== "jsDoc") lists.push(k + "=[" + v.pos + "," + v.end + ")#" + v.length + (v.hasTrailingComma ? " trailing" : ""));
    }
    out.push("  ".repeat(depth) + ts.SyntaxKind[n.kind] + " [" + n.pos + "," + n.end + ") start=" + n.getStart(sf) + (lists.length ? "  LISTS " + lists.join(" ") : ""));
    ts.forEachChild(n, c => walk(c, depth + 1));
  }
  walk(sf, 0);
  const diags = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start + "+" + d.length + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  console.log("=== " + JSON.stringify(src));
  console.log(out.join("\n"));
  if (diags.length) console.log("DIAGS: " + diags.join(" | "));
}
for (const s of process.argv.slice(2)) dump(s);
