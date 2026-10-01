// Prints, per input, what tsc 6.0.2 holds at the places the 38 call sites feed.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
function rng(sf, n) { return `[${n.getStart(sf)},${n.end})`; }
function txt(sf, n) { return JSON.stringify(sf.text.slice(n.getStart(sf), n.end)); }
function list(sf, owner, name, l) {
  if (!l) return;
  console.log(`     ${K[owner.kind]}.${name}: list pos ${l.pos} end ${l.end} count ${l.length}${l.hasTrailingComma ? " trailingComma" : ""} :: ${l.map(x => K[x.kind] + rng(sf, x) + txt(sf, x)).join(" , ")}`);
}
for (const { name, file, text } of inputs) {
  const sf = ts.createSourceFile(file || "a.ts", text, ts.ScriptTarget.Latest, true);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  (function walk(n) {
    const k = n.kind;
    const owner = `${K[k]}${rng(sf, n)}`;
    if (n.type && !ts.isTypeNode(n) && k !== K.TypeAliasDeclaration || k === K.TypeAssertionExpression || k === K.AsExpression || k === K.SatisfiesExpression) {
      if (n.type) {
        let key = "";
        if (n.name) key = ` name${rng(sf, n.name)}`;
        if (n.expression) key += ` operand ${K[n.expression.kind]}${rng(sf, n.expression)}`;
        console.log(`   ${owner}${key} .type = ${K[n.type.kind]}${rng(sf, n.type)} ${txt(sf, n.type)}`);
      }
    }
    if (k === K.Parameter && n.name.kind === K.Identifier && n.name.escapedText === "this") console.log(`   ${owner} THIS-PARAM name${rng(sf, n.name)} type ${n.type ? K[n.type.kind] + rng(sf, n.type) : "none"} index ${n.parent.parameters.indexOf(n)}`);
    if (k === K.Parameter || k === K.VariableDeclaration || k === K.PropertyDeclaration) {
      const fl = [];
      if (n.questionToken) fl.push(`? at ${n.questionToken.getStart(sf)}`);
      if (n.exclamationToken) fl.push(`! at ${n.exclamationToken.getStart(sf)}`);
      if (n.dotDotDotToken) fl.push(`... at ${n.dotDotDotToken.getStart(sf)}`);
      if (fl.length) console.log(`   ${owner} tokens ${fl.join(" ")}`);
    }
    if (!ts.isTypeNode(n) && !ts.isTypeElement(n) || k === K.ExpressionWithTypeArguments) {
      list(sf, n, "typeParameters", n.typeParameters);
      list(sf, n, "typeArguments", n.typeArguments);
    }
    if (k === K.HeritageClause) console.log(`   ${owner} token ${K[n.token]} :: ${n.types.map(x => K[x.kind] + rng(sf, x) + " expr " + K[x.expression.kind] + rng(sf, x.expression) + (x.typeArguments ? ` targs pos ${x.typeArguments.pos} end ${x.typeArguments.end}` : "")).join(" , ")}`);
    if (k === K.IndexSignature) console.log(`   ${owner} params ${n.parameters.map(x => K[x.kind] + rng(sf, x) + " name" + rng(sf, x.name) + " type " + (x.type ? K[x.type.kind] + rng(sf, x.type) : "none")).join(",")} type ${n.type ? K[n.type.kind] + rng(sf, n.type) : "none"} modifiers ${(n.modifiers || []).map(m => K[m.kind]).join(",")}`);
    if (k === K.TypeAliasDeclaration) console.log(`   ${owner} name${rng(sf, n.name)} .type = ${K[n.type.kind]}${rng(sf, n.type)}`);
    if (k === K.InterfaceDeclaration) console.log(`   ${owner} name${rng(sf, n.name)} members ${n.members.length}`);
    if (k === K.CallExpression || k === K.NewExpression || k === K.TaggedTemplateExpression || k === K.ExpressionWithTypeArguments || k === K.JsxOpeningElement || k === K.JsxSelfClosingElement || k === K.Decorator || k === K.NonNullExpression || k === K.ParenthesizedExpression) {
      const e = n.expression || n.tag || n.tagName;
      console.log(`   ${owner} -> ${K[e.kind]}${rng(sf, e)}${n.questionDotToken ? " ?. at " + n.questionDotToken.getStart(sf) : ""}`);
    }
    if (k === K.ArrowFunction || k === K.FunctionDeclaration || k === K.FunctionExpression || k === K.MethodDeclaration || k === K.Constructor || k === K.GetAccessor || k === K.SetAccessor) {
      const open = sf.text.indexOf("(", n.typeParameters ? n.typeParameters.end : (n.name ? n.name.end : n.getStart(sf)));
      console.log(`   ${owner} params pos ${n.parameters.pos} end ${n.parameters.end}${n.body ? " body" + rng(sf, n.body) : " no body"}${n.equalsGreaterThanToken ? " => at " + n.equalsGreaterThanToken.getStart(sf) : ""}`);
    }
    if (k === K.ClassDeclaration || k === K.ClassExpression) {
      const kw = n.getChildren(sf).find(c => c.kind === K.ClassKeyword);
      console.log(`   ${owner} class keyword at ${kw ? kw.getStart(sf) : "?"}`);
    }
    ts.forEachChild(n, walk);
  })(sf);
}
