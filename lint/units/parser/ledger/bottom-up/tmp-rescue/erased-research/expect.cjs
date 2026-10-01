// For each input: the statements that Bun's parse pass erases, as tsc sees them, with the list key and the index of the next kept statement.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const hasMod = (n, k) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) || [] : []).some(m => m.kind === k);
function allTypeOnly(list) { return list.elements.length > 0 && list.elements.every(e => e.isTypeOnly); }
function instantiated(n) { // Bun: a namespace stays when its body keeps a statement other than a non-exported import-equals
  if (!n.body) return false;
  if (ts.isModuleDeclaration(n.body)) return true; // the nested placeholder counts as a statement
  return n.body.statements.some(s => !erased(s, false) && !(ts.isImportEqualsDeclaration(s) && !hasMod(s, K.ExportKeyword)));
}
function erased(n, ambient) {
  if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isNamespaceExportDeclaration(n)) return true;
  const declare = hasMod(n, K.DeclareKeyword);
  if (ts.isVariableStatement(n)) return declare;
  if (ts.isFunctionDeclaration(n)) return declare || ambient || !n.body;
  if (ts.isClassDeclaration(n) || ts.isEnumDeclaration(n)) return declare || ambient;
  if (ts.isModuleDeclaration(n)) return declare || ambient || !instantiated(n);
  if (ts.isImportEqualsDeclaration(n)) return declare || ambient || n.isTypeOnly;
  if (ts.isImportDeclaration(n)) { const c = n.importClause; if (!c) return false; if (c.isTypeOnly || c.phaseModifier === K.TypeKeyword) return true; return !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && allTypeOnly(c.namedBindings); }
  if (ts.isExportDeclaration(n)) { if (n.isTypeOnly) return true; return n.exportClause && ts.isNamedExports(n.exportClause) && allTypeOnly(n.exportClause); }
  return false;
}
function dropsSilently(n) { return n.kind === K.EmptyStatement; }
for (const { name, text } of inputs) {
  const sf = ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest, true);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  if (sf.parseDiagnostics.length) console.log("   (tsc reports parse errors)");
  function list(stmts, key, ambient, how) {
    let kept = 0;
    for (const s of stmts) {
      const amb = ambient || hasMod(s, K.DeclareKeyword);
      if (erased(s, ambient)) {
        const mods = (ts.canHaveModifiers(s) ? ts.getModifiers(s) || [] : []).map(m => `${K[m.kind].replace("Keyword", "").replace("FirstContextual", "abstract").toLowerCase()}@${m.getStart(sf)}`);
        const decs = (ts.canHaveDecorators(s) ? ts.getDecorators(s) || [] : []).map(m => `@${m.getStart(sf)}`);
        const nm = s.name ? ` name=${s.name.getText(sf)}@${s.name.getStart(sf)}` : "";
        console.log(`   ${K[s.kind]} [${s.getStart(sf)}..${s.end}] ${how === "list" ? `InList(${key},${kept})` : "Placeholder"}${nm} ${[...decs, ...mods].join(" ")}`);
      } else if (!dropsSilently(s)) kept++;
      walk(s, amb);
    }
  }
  function walk(n, ambient) {
    if (ts.isSourceFile(n)) return list(n.statements, -100, false, "list");
    if (ts.isBlock(n)) {
      const p = n.parent;
      let key = n.getStart(sf);
      if (ts.isTryStatement(p) && p.tryBlock === n) key = p.getStart(sf);
      if (ts.isTryStatement(p) && p.finallyBlock === n) key = ts.findChildOfKind(p, K.FinallyKeyword, sf).getStart(sf);
      return list(n.statements, key, ambient, "list");
    }
    if (ts.isModuleBlock(n)) {
      const p = n.parent; // namespace body: key is the loc the Entry scope was pushed with
      const nested = ts.isModuleDeclaration(p.parent);
      let key;
      if (p.flags & ts.NodeFlags.GlobalAugmentation) key = n.getStart(sf); // `{` of the global body
      else if (nested) key = p.name.getStart(sf) - 1 - (text.slice(0, p.name.getStart(sf)).length - text.slice(0, p.name.getStart(sf)).trimEnd().length); // the dot
      else key = ts.getModifiers(p)?.length ? p.name.getStart(sf) - (text.slice(0, p.name.getStart(sf)).match(/(namespace|module)\s*$/)[0].length) : p.getStart(sf);
      return list(n.statements, key, ambient, "list");
    }
    if (ts.isCaseClause(n) || ts.isDefaultClause(n)) return list(n.statements, 0, ambient, "placeholder");
    const single = (s) => { if (s && !ts.isBlock(s)) list([s], 0, ambient, "placeholder"); else if (s) walk(s, ambient); };
    if (ts.isIfStatement(n)) { ts.forEachChild(n.expression, c => walk(c, ambient)); single(n.thenStatement); single(n.elseStatement); return; }
    if (ts.isIterationStatement(n, false) || ts.isLabeledStatement(n) || ts.isWithStatement(n)) { ts.forEachChild(n, c => { if (c !== n.statement) walk(c, ambient); }); single(n.statement); return; }
    if (ts.isModuleDeclaration(n) && n.body && ts.isModuleDeclaration(n.body)) { list([n.body], 0, true && ambient, "placeholder-nested"); return; }
    ts.forEachChild(n, c => walk(c, ambient));
  }
  walk(sf, false);
}
