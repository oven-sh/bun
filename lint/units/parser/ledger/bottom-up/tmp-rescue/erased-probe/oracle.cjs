const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const K = ts.SyntaxKind;
for (const d of sf.parseDiagnostics) console.log(`diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
function mods(n) { return (n.modifiers || []).map(m => `${K[m.kind]}@${m.getStart(sf)}`).join(","); }
function show(n, depth) {
  const name = n.name ? (n.name.text ?? n.name.getText(sf)) : "";
  console.log(`${"  ".repeat(depth)}${K[n.kind]} ${n.getStart(sf)}-${n.end} [${mods(n)}] ${JSON.stringify(name)}`);
}
function walk(n, depth) {
  if (ts.isStatement(n) || ts.isClassElement(n) || ts.isModuleBlock(n) || n.kind === K.ImportClause || n.kind === K.NamedImports || n.kind === K.NamedExports || n.kind === K.ImportSpecifier || n.kind === K.ExportSpecifier || n.kind === K.NamespaceImport || n.kind === K.NamespaceExport || n.kind === K.ExternalModuleReference || n.kind === K.EnumMember || n.kind === K.ModuleDeclaration) { show(n, depth); depth++; }
  ts.forEachChild(n, c => walk(c, depth));
}
ts.forEachChild(sf, c => walk(c, 0));
