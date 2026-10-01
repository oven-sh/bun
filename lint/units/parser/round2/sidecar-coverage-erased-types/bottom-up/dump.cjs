// usage: node dump.cjs '<source>' [ext]   prints the tree of tsc 6.0.2: Kind[getStart,end) per node, and the lists with (pos,end)
const ts = require("/workspace/bun/node_modules/typescript");
const src = process.argv[2];
const ext = process.argv[3] || "ts";
const sf = ts.createSourceFile("a." + ext, src, ts.ScriptTarget.Latest, true);
const kindName = k => {
  // the first name of the enum value, not the alias
  for (const name of Object.keys(ts.SyntaxKind)) { if (ts.SyntaxKind[name] === k && !/^(First|Last)/.test(name)) return name; }
  return ts.SyntaxKind[k];
};
function walk(node, depth) {
  const pad = "  ".repeat(depth);
  let extra = "";
  for (const key of ["modifiers", "typeParameters", "heritageClauses", "types", "members", "parameters", "typeArguments", "elements"]) {
    const list = node[key];
    if (list && typeof list.pos === "number") extra += ` ${key}(${list.pos},${list.end})${list.hasTrailingComma ? "," : ""}`;
  }
  if (node.kind === ts.SyntaxKind.HeritageClause) extra += ` token=${kindName(node.token)}`;
  if (node.kind === ts.SyntaxKind.Identifier || node.kind === ts.SyntaxKind.PrivateIdentifier) extra += ` "${node.text}"`;
  console.log(`${pad}${kindName(node.kind)}[${node.getStart(sf)},${node.end})${extra}`);
  ts.forEachChild(node, c => walk(c, depth + 1));
}
console.log(JSON.stringify(src));
if (sf.parseDiagnostics.length) console.log("  parse diagnostics:", sf.parseDiagnostics.map(d => `TS${d.code}[${d.start},+${d.length})`).join(" "));
sf.statements.forEach(s => walk(s, 1));
