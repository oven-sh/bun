// Prints the expression tree of tsc for each input: kind, token start, end.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const want = new Set([
  K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression, K.ParenthesizedExpression,
  K.ExpressionWithTypeArguments, K.CallExpression, K.PropertyAccessExpression, K.ElementAccessExpression,
  K.BinaryExpression, K.Identifier, K.ArrowFunction, K.Parameter, K.PostfixUnaryExpression, K.PrefixUnaryExpression,
  K.ConditionalExpression, K.TaggedTemplateExpression, K.NewExpression, K.Decorator, K.TypeOfExpression,
  K.DeleteExpression, K.ObjectLiteralExpression, K.ArrayLiteralExpression, K.NumericLiteral, K.StringLiteral,
  K.AwaitExpression, K.VoidExpression, K.SpreadElement, K.TemplateExpression, K.NoSubstitutionTemplateLiteral,
  K.FunctionExpression, K.ClassExpression, K.RegularExpressionLiteral, K.ThisKeyword, K.JsxElement,
  K.JsxSelfClosingElement, K.JsxExpression, K.PropertyDeclaration, K.MethodDeclaration, K.Constructor,
  K.VariableDeclaration, K.EnumDeclaration, K.ClassDeclaration, K.ImportSpecifier, K.ExportSpecifier,
  K.ImportDeclaration, K.ExportDeclaration, K.ImportClause, K.GetAccessor, K.SetAccessor, K.IndexSignature,
  K.QuestionToken, K.ExclamationToken,
]);
function mods(n) {
  const m = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  const d = ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined;
  const all = n.modifiers;
  if (!all || !all.length) return "";
  return " mods[" + all.map(x => `${K[x.kind]}@${x.getStart()}-${x.end}`).join(",") + "]";
}
for (const { name, file, text } of inputs) {
  const fileName = file || "a.ts";
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  console.log(`== ${name || ""} ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  (function walk(n, depth) {
    let shown = false;
    if (want.has(n.kind) && !ts.isTypeNode(n)) {
      shown = true;
      let extra = mods(n);
      if (n.questionToken) extra += ` ?@${n.questionToken.getStart()}`;
      if (n.exclamationToken) extra += ` !@${n.exclamationToken.getStart()}`;
      if (n.isTypeOnly) extra += ` typeOnly`;
      if (n.flags & ts.NodeFlags.OptionalChain) extra += " OptionalChain";
      console.log(`   ${"  ".repeat(depth)}${K[n.kind]} [${n.getStart(sf)},${n.end}) ${JSON.stringify(text.slice(n.getStart(sf), n.end))}${extra}`);
    }
    if (ts.isTypeNode(n) && n.kind !== K.ExpressionWithTypeArguments) {
      console.log(`   ${"  ".repeat(depth)}<type ${K[n.kind]} [${n.getStart(sf)},${n.end})>`);
      return;
    }
    ts.forEachChild(n, c => walk(c, depth + (shown ? 1 : 0)));
  })(sf, 0);
}
