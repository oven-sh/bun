// Expected dump of the type-only lint entry, from the tree of tsc (typescript 6.0.2).
// usage: node type-oracle.cjs <type-inputs.json>      (TYPESCRIPT=<path> overrides the package)
// Input: [{ "name", "text" }]: `text` is read as one type, what follows the type stays unread.
// The text is parsed as `let x: <text>`; offsets are printed relative to the start of `text`.
// Output per input, the format the dump of the entry must have:
//   == <name>  <json text>
//   [diag TS<code> <start>+<length>]        only when tsc reports a syntax error
//   <indent><Kind> <start> <end>            start = first character of the first token, end = after the last token
//   <indent> list <property> <pos> <end> <count> [trailing]      pos = after the opening token, end = end of the last
//                                                                item or of the separator behind it
//   rest <offset>                           start of the first token behind the type (length of text at the end)
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const K = ts.SyntaxKind;
const PREFIX = "let x: ";
const NAME = { FirstTypeNode: "TypePredicate", LastTypeNode: "ImportType", FirstNode: "QualifiedName", LastTemplateToken: "TemplateTail",
  FirstLiteralToken: "NumericLiteral", FirstTemplateToken: "NoSubstitutionTemplateLiteral", AssertClause: "ImportAttributes", AssertEntry: "ImportAttribute" };
const kind = n => NAME[K[n.kind]] || K[n.kind];
function shown(n) {
  return ts.isTypeNode(n) || ts.isTypeParameterDeclaration(n) || ts.isTypeElement(n) || n.kind === K.QualifiedName || n.kind === K.Parameter ||
    n.kind === K.TemplateLiteralTypeSpan || n.kind === K.TemplateHead || n.kind === K.TemplateMiddle || n.kind === K.TemplateTail ||
    n.kind === K.NamedTupleMember || n.kind === K.ImportAttributes || n.kind === K.ImportAttribute || n.kind === K.ComputedPropertyName ||
    n.kind === K.ObjectBindingPattern || n.kind === K.ArrayBindingPattern || n.kind === K.BindingElement;
}
for (const { name, text } of inputs) {
  const full = PREFIX + text;
  const sf = ts.createSourceFile("a.ts", full, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const off = PREFIX.length;
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`diag TS${d.code} ${d.start - off}+${d.length}`);
  const decl = sf.statements[0].declarationList.declarations[0];
  const type = decl.type;
  (function walk(n, depth) {
    const pad = " ".repeat(depth);
    if (shown(n)) console.log(`${pad}${kind(n)} ${n.getStart(sf) - off} ${n.end - off}`);
    // The list of a union or an intersection has the range of its node: it is not printed.
    for (const key of ["typeParameters", "parameters", "typeArguments", "elements", "members", "templateSpans"]) {
      const l = n[key];
      if (l && typeof l.pos === "number") console.log(`${pad} list ${key} ${l.pos - off} ${l.end - off} ${l.length}${l.hasTrailingComma ? " trailing" : ""}`);
    }
    ts.forEachChild(n, c => walk(c, depth + (shown(n) ? 1 : 0)));
  })(type, 0);
  console.log(`rest ${ts.skipTrivia(full, type.end) - off}`);
}
