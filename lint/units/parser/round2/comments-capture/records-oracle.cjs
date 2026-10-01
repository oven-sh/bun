// For each input: the nodes tsc 6.0.2 makes for the syntax a lint parse keeps in its side table, with pos (full start), start and end in UTF-8 bytes.
const ts = require("/workspace/bun/node_modules/typescript");
const K = ts.SyntaxKind;
const want = new Set([
  K.InterfaceDeclaration, K.TypeAliasDeclaration, K.VariableStatement, K.FunctionDeclaration, K.ModuleDeclaration, K.EnumDeclaration,
  K.MethodDeclaration, K.PropertyDeclaration, K.IndexSignature, K.Constructor,
  K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.ParenthesizedExpression, K.TypeAssertionExpression,
  K.TypeReference, K.NumberKeyword, K.StringKeyword, K.VoidKeyword, K.LiteralType, K.TypeQuery, K.MappedType, K.TypeLiteral, K.PropertySignature, K.ComputedPropertyName,
  K.TypeParameter, K.Parameter, K.HeritageClause, K.ExpressionWithTypeArguments,
  K.ImportSpecifier, K.ExportSpecifier, K.ImportDeclaration,
  K.PublicKeyword, K.ReadonlyKeyword, K.AbstractKeyword, K.DeclareKeyword, K.QuestionToken, K.ExclamationToken,
  K.JsxSelfClosingElement, K.JsxOpeningElement, K.CallExpression, K.NewExpression, K.ClassDeclaration, K.ElementAccessExpression,
]);
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const [file, text] of inputs) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  const b = i => Buffer.byteLength(text.slice(0, i), "utf8");
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}`);
  console.log(`== ${file}  ${JSON.stringify(text)}${diags.length ? "  PARSE-DIAGS " + diags.join(",") : ""}`);
  const list = (name, arr) => arr && console.log(`   ${name}<list> pos=${b(arr.pos)} end=${b(arr.end)}`);
  (function visit(n, depth) {
    if (want.has(n.kind)) {
      console.log(`   ${"  ".repeat(Math.min(depth, 6))}${K[n.kind]} pos=${b(n.pos)} start=${b(n.getStart(sf))} end=${b(n.end)} ${JSON.stringify(text.slice(n.getStart(sf), n.end))}`);
    }
    list("typeParameters", n.typeParameters);
    list("typeArguments", n.typeArguments);
    ts.forEachChild(n, c => visit(c, depth + 1));
  })(sf, 0);
}
