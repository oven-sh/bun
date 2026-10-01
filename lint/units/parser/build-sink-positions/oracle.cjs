// Prints, for each input, the parse diagnostics of tsc and every type-level node with token start, full start and end.
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const K = ts.SyntaxKind;
function isTypeSide(n) {
  return ts.isTypeNode(n) || ts.isTypeParameterDeclaration(n) || ts.isTypeElement(n) || n.kind === K.QualifiedName ||
    n.kind === K.Parameter && n.parent && (ts.isTypeNode(n.parent) || ts.isTypeElement(n.parent)) ||
    n.kind === K.TemplateLiteralTypeSpan || n.kind === K.TemplateHead || n.kind === K.TemplateMiddle || n.kind === K.TemplateTail ||
    n.kind === K.ExpressionWithTypeArguments || n.kind === K.TypePredicate || n.kind === K.NamedTupleMember;
}
for (const { name, file, text } of inputs) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const lists = [];
  (function walk(n, depth) {
    if (isTypeSide(n)) console.log(`   ${" ".repeat(depth)}${K[n.kind]} start ${n.getStart(sf)} end ${n.end} (full start ${n.pos}) ${JSON.stringify(text.slice(n.getStart(sf), n.end))}`);
    for (const key of ["typeArguments", "typeParameters", "types", "elements", "members", "parameters", "templateSpans"]) {
      const l = n[key];
      if (l && typeof l.pos === "number" && (isTypeSide(n) || key === "typeArguments" || key === "typeParameters")) console.log(`   ${" ".repeat(depth)} list ${K[n.kind]}.${key} pos ${l.pos} end ${l.end} count ${l.length} trailingComma ${!!l.hasTrailingComma}`);
    }
    ts.forEachChild(n, c => walk(c, depth + (isTypeSide(n) ? 1 : 0)));
  })(sf, 0);
}
