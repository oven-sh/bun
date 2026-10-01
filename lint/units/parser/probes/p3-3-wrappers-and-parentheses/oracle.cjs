// Expected wrapper records of a lint parse, read from the tree of tsc 6.0.2: one line per record, in post-order.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const TAGS = {
  [K.Identifier]: "e_identifier", [K.PropertyAccessExpression]: "e_dot", [K.ElementAccessExpression]: "e_index",
  [K.CallExpression]: "e_call", [K.BinaryExpression]: "e_binary", [K.NumericLiteral]: "e_number",
  [K.StringLiteral]: "e_string", [K.ArrowFunction]: "e_arrow", [K.FunctionExpression]: "e_function",
  [K.PostfixUnaryExpression]: "e_unary", [K.PrefixUnaryExpression]: "e_unary", [K.ArrayLiteralExpression]: "e_array",
  [K.ObjectLiteralExpression]: "e_object", [K.ThisKeyword]: "e_this", [K.ConditionalExpression]: "e_if",
  [K.NewExpression]: "e_new",
};
const isWrapper = n => [K.ParenthesizedExpression, K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression].includes(n.kind);
function lines(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const diags = sf.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " "));
  const out = [];
  // Where the node of Bun starts: a node that begins with its left operand starts where that operand does, inside its parentheses.
  const start = n => {
    while (isWrapper(n)) n = n.expression;
    if (n.kind === K.BinaryExpression) return start(n.left);
    if (n.kind === K.PropertyAccessExpression || n.kind === K.ElementAccessExpression || n.kind === K.CallExpression) return start(n.expression);
    if (n.kind === K.PostfixUnaryExpression) return start(n.operand);
    if (n.kind === K.ConditionalExpression) return start(n.condition);
    return n.getStart(sf);
  };
  const operand = n => { while (isWrapper(n)) n = n.expression; const tag = TAGS[n.kind]; if (!tag) throw new Error("no tag for " + K[n.kind] + " in " + text); return `${tag}@${start(n)}`; };
  const token = (n, k) => n.getChildren(sf).find(c => c.kind === k);
  const kindName = k => { const name = K[k]; return name === 'FirstTypeNode' ? 'TypePredicate' : name === 'LastTypeNode' ? 'ImportType' : name; };
  const type = t => `${kindName(t.kind)}${t.kind === K.TypeReference && t.typeName.kind === K.Identifier ? '(' + t.typeName.text + ')' : ''}[${t.getStart(sf)},${t.end})`;
  (function walk(n) {
    ts.forEachChild(n, walk);
    if (n.kind === K.AsExpression) out.push(`AsExpression [${token(n, K.AsKeyword).getStart(sf)},${n.type.end}) ${type(n.type)} of ${operand(n.expression)}`);
    else if (n.kind === K.SatisfiesExpression) out.push(`SatisfiesExpression [${token(n, K.SatisfiesKeyword).getStart(sf)},${n.type.end}) ${type(n.type)} of ${operand(n.expression)}`);
    else if (n.kind === K.NonNullExpression) out.push(`NonNullExpression [${n.end - 1},${n.end}) of ${operand(n.expression)}`);
    else if (n.kind === K.TypeAssertionExpression) out.push(`TypeAssertionExpression [${n.getStart(sf)},${token(n, K.GreaterThanToken).end}) ${type(n.type)} of ${operand(n.expression)}`);
    else if (n.kind === K.ParenthesizedExpression) out.push(`ParenthesizedExpression [${n.getStart(sf)},${n.end}) of ${operand(n.expression)}`);
  })(sf);
  return { out, diags };
}
module.exports = { lines };
if (require.main === module) {
  const cases = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  for (const c of cases) {
    const { out, diags } = lines(c.path, c.text);
    console.log(`== ${c.name} (${c.path}) ${JSON.stringify(c.text)}${diags.length ? "  TSC DIAGNOSTICS: " + diags.join(" | ") : ""}`);
    for (const l of out) console.log("   " + JSON.stringify(l) + ",");
  }
}
