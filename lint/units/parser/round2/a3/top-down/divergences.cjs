// The sources of the synthetic corpus (grammar-diff/corpus.small.json) where a parse without lint and the lint parse pass both succeed and print different bytes, with the reading of tsc 6.0.2.
// usage: bun divergences.cjs <analysis.small.json of the normal-vs-switch run> > divergences.tsv
const fs = require("node:fs");
const ts = require("/workspace/wt/parser/node_modules/typescript");
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rows = [];
for (const s of a["A>A all"]) {
  const sf = ts.createSourceFile("a.ts", s.src, { languageVersion: ts.ScriptTarget.ESNext }, true, ts.ScriptKind.TS);
  const st = sf.statements[0];
  let shape;
  if (ts.isExpressionStatement(st)) shape = ts.isCallExpression(st.expression) ? "call with type arguments" : ts.SyntaxKind[st.expression.kind];
  else if (ts.isClassDeclaration(st)) { const m = st.members[0]; shape = `${sf.statements.length} statement(s), class with ${st.members.length} member(s)${m && ts.isMethodDeclaration(m) ? ", method body=" + !!m.body : ""}, heritage=${st.heritageClauses?.map(h => h.types.map(t => t.getText()).join("|")).join(";")}`; }
  else if (ts.isFunctionDeclaration(st)) shape = `function body=${!!st.body} type=${st.type?.getText()}`;
  else shape = ts.SyntaxKind[st.kind];
  const diag = sf.parseDiagnostics.map(x => "TS" + x.code).join(",") || "none";
  const read = t => (/^f\(x\);/.test(t) ? "call" : /^f </.test(t) ? "comparison" : JSON.stringify(t));
  const [normal, lint] = [read(s.base[1]), read(s.next[1])];
  const tsc = shape.startsWith("call") ? "call" : shape === "BinaryExpression" ? "comparison" : shape;
  let verdict = tsc === lint ? "lint reads as tsc" : tsc === normal ? "normal reads as tsc" : "by statement count";
  rows.push([verdict, diag, JSON.stringify(s.src), normal, lint, shape, s.prod, String(s.mut), s.ctx]);
}
rows.sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]));
console.log(["verdict", "tsc parse diagnostics", "source", "normal", "lint", "tsc tree", "production", "mutation", "context"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
