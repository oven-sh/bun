// Prints for each input the statement-level nodes of tsc with token start, end, kind, modifiers.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
function mods(n) {
  const m = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  const d = ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined;
  const out = [];
  for (const x of d || []) out.push(`@[${x.getStart()}..${x.end}]`);
  for (const x of m || []) out.push(`${K[x.kind]}[${x.getStart()}..${x.end}]`);
  return out.join(" ");
}
for (const { name, file, text } of inputs) {
  const sf = ts.createSourceFile(file || "a.ts", text, ts.ScriptTarget.Latest, true);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  (function walk(n, depth) {
    const isStmtLike = ts.isStatement(n) || ts.isClassElement(n) || ts.isModuleBlock(n) || ts.isImportClause(n) || ts.isNamedImports(n) || ts.isNamedExports(n) || ts.isImportSpecifier(n) || ts.isExportSpecifier(n) || ts.isNamespaceImport(n) || ts.isNamespaceExport(n) || ts.isExternalModuleReference(n) || ts.isImportAttributes?.(n) || ts.isImportAttribute?.(n) || ts.isEnumMember(n) || ts.isHeritageClause(n);
    if (isStmtLike) {
      const nm = n.name ? ` name=${JSON.stringify(n.name.getText(sf))}[${n.name.getStart(sf)}..${n.name.end}]` : "";
      const ms = n.moduleSpecifier ? ` path=${n.moduleSpecifier.getText(sf)}[${n.moduleSpecifier.getStart(sf)}..${n.moduleSpecifier.end}]` : "";
      const to = n.isTypeOnly ? " typeOnly" : (n.phaseModifier ? ` phase=${K[n.phaseModifier]}` : "");
      const fl = (n.flags & ts.NodeFlags.Ambient ? " Ambient" : "") + (n.flags & ts.NodeFlags.Namespace ? " Namespace" : "") + (n.flags & ts.NodeFlags.GlobalAugmentation ? " Global" : "");
      console.log(`   ${"  ".repeat(depth)}${K[n.kind]} [${n.getStart(sf)}..${n.end}] full ${n.pos}${nm}${ms}${to}${fl} mods(${mods(n)}) ${JSON.stringify(text.slice(n.getStart(sf), n.end)).slice(0, 70)}`);
    }
    ts.forEachChild(n, c => walk(c, depth + (isStmtLike ? 1 : 0)));
  })(sf, 0);
}
