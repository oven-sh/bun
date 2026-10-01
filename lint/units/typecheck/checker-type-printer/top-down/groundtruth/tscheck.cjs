// Checks with TypeScript 6.0.2 which of the round trip texts parse as one type alias without a parse diagnostic,
// and prints the kinds of type syntax that occur in them.
const ts = require("/workspace/wt/typecheck/node_modules/typescript");
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.length > 0);
let ok = 0, bad = [];
const kinds = new Map();
for (const text of lines) {
  const sf = ts.createSourceFile("/t.ts", "type __T = " + text + ";", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length > 0 || sf.statements.length !== 1 || sf.statements[0].kind !== ts.SyntaxKind.TypeAliasDeclaration) { bad.push(text); continue; }
  ok++;
  const visit = n => { const k = ts.SyntaxKind[n.kind]; kinds.set(k, (kinds.get(k) || 0) + 1); ts.forEachChild(n, visit); };
  visit(sf.statements[0].type);
}
console.log("texts", lines.length, "parse with typescript", ts.version, ":", ok, "not:", bad.length);
for (const b of bad.slice(0, 10)) console.log("  not:", b.slice(0, 120));
console.log([...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v).join(", "));
