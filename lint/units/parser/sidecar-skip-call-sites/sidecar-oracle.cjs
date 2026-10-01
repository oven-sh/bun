// Prints, per input, the records that the 38 call sites must leave, in the order of their start offset.
// Source of truth: the tree of tsc (typescript 6.0.2). Keys are the offsets that Bun's tree holds.
// usage: node sidecar-oracle.cjs <inputs.json>   (TYPESCRIPT=<path> overrides the package)
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const TAG = { Identifier: "EIdentifier", PropertyAccessExpression: "EDot", ElementAccessExpression: "EIndex", CallExpression: "ECall",
  NewExpression: "ENew", ThisKeyword: "EThis", SuperKeyword: "ESuper", ArrayLiteralExpression: "EArray", ObjectLiteralExpression: "EObject",
  StringLiteral: "EString", NumericLiteral: "ENumber", ClassExpression: "EClass", FunctionExpression: "EFunction", ArrowFunction: "EArrow",
  TaggedTemplateExpression: "ETemplate", JsxElement: "EJsxElement", JsxSelfClosingElement: "EJsxElement" };
for (const { name, file, text } of inputs) {
  const sf = ts.createSourceFile(file || "a.ts", text, ts.ScriptTarget.Latest, true);
  const out = [];
  const ty = n => `${K[n.kind] === "FirstTypeNode" ? "TypePredicate" : K[n.kind]}[${n.getStart(sf)},${n.end})`;
  const colonOf = t => t.pos - 1;
  const afterGt = l => ts.skipTrivia(text, l.end) + 1;
  const lst = l => `lt=${l.pos - 1} list=[${l.pos},${l.end}) count=${l.length}${l.hasTrailingComma ? " trailing-comma" : ""} end=${afterGt(l)}`;
  // The operand that Bun holds: wrappers that leave no node are looked through.
  function bare(e) {
    for (;;) {
      if (e.kind === K.ParenthesizedExpression || e.kind === K.NonNullExpression || e.kind === K.AsExpression || e.kind === K.SatisfiesExpression ||
          e.kind === K.TypeAssertionExpression || e.kind === K.ExpressionWithTypeArguments) e = e.expression; else return e;
    }
  }
  const tag = b => `${TAG[K[b.kind]] || K[b.kind]}@${b.getStart(sf)}`;
  const opnd = e => tag(bare(e));
  // What Bun's parse_prefix returned when the cast was read: the primary expression under the suffixes.
  function prefixOperand(e) {
    for (;;) {
      if (e.kind === K.ParenthesizedExpression) return bare(e.expression);
      if (e.kind === K.PropertyAccessExpression || e.kind === K.ElementAccessExpression || e.kind === K.CallExpression || e.kind === K.NonNullExpression ||
          e.kind === K.ExpressionWithTypeArguments || e.kind === K.TypeAssertionExpression) e = e.expression;
      else if (e.kind === K.TaggedTemplateExpression) e = e.tag;
      else if (e.kind === K.PostfixUnaryExpression) e = e.operand;
      else return e;
    }
  }
  const openParen = n => n.parameters.pos - 1;
  const classKw = n => n.getChildren(sf).find(c => c.kind === K.ClassKeyword).getStart(sf);
  const fnKey = n => n.kind === K.ArrowFunction ? `arrow=${n.getStart(sf)}` : `fn=${openParen(n)}`;
  const isFn = n => [K.ArrowFunction, K.FunctionDeclaration, K.FunctionExpression, K.MethodDeclaration, K.Constructor, K.GetAccessor, K.SetAccessor].includes(n.kind);
  const isTypeSide = n => ts.isTypeNode(n) && n.kind !== K.ExpressionWithTypeArguments || ts.isTypeElement(n) && !ts.isClassElement(n) || n.kind === K.TypeAliasDeclaration || n.kind === K.InterfaceDeclaration;
  (function walk(n, inType) {
    const k = n.kind;
    if (!inType) {
      if ((k === K.VariableDeclaration || k === K.Parameter) && n.parent.kind !== K.IndexSignature) {
        const isThis = k === K.Parameter && n.name.kind === K.Identifier && n.name.escapedText === "this";
        if (isThis) out.push([n.getStart(sf), `this-param fn=${openParen(n.parent)} index=${n.parent.parameters.indexOf(n)} this=[${n.name.getStart(sf)},${n.name.end})${n.type ? ` colon=${colonOf(n.type)} type=${ty(n.type)}` : ""}`]);
        else if (n.type || n.exclamationToken) out.push([n.name.getStart(sf), `binding-type key=${n.name.getStart(sf)}${n.exclamationToken ? ` excl=${n.exclamationToken.getStart(sf)}` : ""}${n.type ? ` colon=${colonOf(n.type)} type=${ty(n.type)}` : ""}`]);
      }
      if (k === K.PropertyDeclaration && n.type) {
        const key = n.name.kind === K.ComputedPropertyName ? n.name.expression.getStart(sf) : n.name.getStart(sf);
        out.push([key, `property-type key=${key} colon=${colonOf(n.type)} type=${ty(n.type)}`]);
      }
      if (isFn(n)) {
        if (n.typeParameters) out.push([n.typeParameters.pos - 1, `type-params ${fnKey(n)} ${lst(n.typeParameters)}`]);
        if (n.type) out.push([colonOf(n.type), `return-type ${fnKey(n)} colon=${colonOf(n.type)} type=${ty(n.type)}`]);
      }
      if (k === K.ClassDeclaration || k === K.ClassExpression) {
        const kw = classKw(n);
        if (n.typeParameters) out.push([n.typeParameters.pos - 1, `type-params class=${kw} ${lst(n.typeParameters)}`]);
        for (const h of n.heritageClauses || []) {
          if (h.token === K.ExtendsKeyword) out.push([h.getStart(sf), `heritage class=${kw} extends=${h.getStart(sf)}`]);
          else out.push([h.getStart(sf), `heritage class=${kw} implements=${h.getStart(sf)} types=${h.types.map(t => `TypeReference[${t.getStart(sf)},${t.end})`).join(",")}`]);
        }
      }
      if (k === K.ExpressionWithTypeArguments && n.typeArguments && !(n.parent.kind === K.HeritageClause && n.parent.token === K.ImplementsKeyword))
        out.push([n.typeArguments.pos - 1, `expr-type-args operand=${opnd(n.expression)} ${lst(n.typeArguments)}`]);
      if ((k === K.CallExpression || k === K.NewExpression || k === K.TaggedTemplateExpression) && n.typeArguments) {
        const e = n.expression || n.tag;
        if (n.questionDotToken) out.push([n.typeArguments.pos - 1, `optional-call-type-args callee=${opnd(e)} ${lst(n.typeArguments)}`]);
        else out.push([n.typeArguments.pos - 1, `expr-type-args operand=${opnd(e)} ${lst(n.typeArguments)}`]);
      }
      if ((k === K.JsxOpeningElement || k === K.JsxSelfClosingElement) && n.typeArguments) out.push([n.typeArguments.pos - 1, `jsx-type-args element=${n.getStart(sf)} ${lst(n.typeArguments)}`]);
      if (k === K.IndexSignature) {
        const p0 = n.parameters[0]; const open = n.parameters.pos - 1;
        out.push([open, `index-signature start=${open} param=[${p0.name.getStart(sf)},${p0.name.end}) param-type=${p0.type ? ty(p0.type) : "none"} type=${n.type ? ty(n.type) : "none"} end=${n.end}`]);
      }
      if (k === K.TypeAssertionExpression) out.push([n.getStart(sf), `type-assertion lt=${n.getStart(sf)} type=${ty(n.type)} operand=${tag(prefixOperand(n.expression))}`]);
      if (k === K.AsExpression || k === K.SatisfiesExpression) out.push([n.type.pos - (k === K.AsExpression ? 2 : 9), `${k === K.AsExpression ? "as" : "satisfies"} keyword-end=${n.type.pos} type=${ty(n.type)} operand=${opnd(n.expression)}`]);
      if (k === K.TypeAliasDeclaration) out.push([n.getStart(sf), `type-alias name=[${n.name.getStart(sf)},${n.name.end})${n.typeParameters ? " " + lst(n.typeParameters) : ""} type=${ty(n.type)} end=${n.end}`]);
      if (k === K.InterfaceDeclaration) out.push([n.getStart(sf), `interface name=[${n.name.getStart(sf)},${n.name.end})${n.typeParameters ? " " + lst(n.typeParameters) : ""} extends=${(n.heritageClauses || []).flatMap(h => h.types.map(t => `TypeReference[${t.getStart(sf)},${t.end})`)).join(",") || "none"} members=${n.members.length} end=${n.end}`]);
    }
    ts.forEachChild(n, c => walk(c, inType || isTypeSide(n)));
  })(sf, false);
  out.sort((a, b) => a[0] - b[0]);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  for (const [, line] of out) console.log("   " + line);
}
