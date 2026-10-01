const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const K = ts.SyntaxKind;
const only = process.argv[3];
for (const { name, file, text } of inputs) {
  if (only && name !== only) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const s = n => n.getStart(sf);
  const t = n => JSON.stringify(text.slice(s(n), n.end));
  const list = (owner, key, l) => console.log(`   ${owner}.${key} list [${l.pos},${l.end}) count ${l.length}` + (l.hasTrailingComma ? " trailingComma" : ""));
  (function walk(n) {
    const k = K[n.kind];
    if (ts.isVariableDeclaration(n) && n.type) console.log(`   BindingType var name@${s(n.name)} ${n.exclamationToken ? "definite@" + s(n.exclamationToken) + " " : ""}type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) ${t(n.type)}`);
    if (ts.isParameter(n) && !ts.isTypeNode(n.parent) && !(ts.isTypeElement(n.parent) && !ts.isAccessor(n.parent))) {
      const idx = n.parent.parameters.indexOf(n);
      const isThis = ts.isIdentifier(n.name) && n.name.escapedText === "this";
      console.log(`   ${isThis ? "ThisParam" : "BindingType param"} owner ${K[n.parent.kind]}@${s(n.parent)} index ${idx} name@${s(n.name)}${n.dotDotDotToken ? " rest@" + s(n.dotDotDotToken) : ""}${n.questionToken ? " optional@" + s(n.questionToken) : ""}${n.modifiers ? " modifiers " + n.modifiers.map(m => K[m.kind] + "@" + s(m)).join(",") : ""} ${n.type ? `type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) ${t(n.type)}` : "no type"} node [${s(n)},${n.end})`);
    }
    if (ts.isPropertyDeclaration(n)) console.log(`   PropertyType name@${s(n.name)} ${K[n.name.kind]}${n.questionToken ? " optional@" + s(n.questionToken) : ""}${n.exclamationToken ? " definite@" + s(n.exclamationToken) : ""}${n.modifiers ? " modifiers " + n.modifiers.map(m => K[m.kind] + "@" + s(m)).join(",") : ""} ${n.type ? `type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) ${t(n.type)}` : "no type"}`);
    if (ts.isIndexSignatureDeclaration(n) && ts.isClassLike(n.parent)) console.log(`   IndexSignature [${s(n)},${n.end}) ${n.modifiers ? "modifiers " + n.modifiers.map(m => K[m.kind] + "@" + s(m)).join(",") + " " : ""}param name@${s(n.parameters[0].name)} ptype [${s(n.parameters[0].type)},${n.parameters[0].type.end}) type [${s(n.type)},${n.type.end}) ${t(n)}`);
    if (ts.isFunctionLike(n) && !ts.isTypeNode(n) && !(ts.isTypeElement(n) && !ts.isAccessor(n)) && !(ts.isIndexSignatureDeclaration(n))) {
      const open = n.getChildren(sf).find(c => c.kind === K.OpenParenToken);
      const head = `${k}@${s(n)} openParen@${open ? s(open) : "-"}`;
      if (n.typeParameters) { list(head, "typeParameters", n.typeParameters); const lt = n.getChildren(sf).find(c => c.kind === K.LessThanToken); const gt = n.getChildren(sf).find(c => c.kind === K.GreaterThanToken); console.log(`   TypeParams owner ${head} lt@${s(lt)} gtEnd ${gt.end} [${n.typeParameters.map(p => `${t(p)} [${s(p)},${p.end})`).join(", ")}]`); }
      if (n.type) console.log(`   ReturnType owner ${head} type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) ${t(n.type)}`);
      list(head, "parameters", n.parameters);
    }
    if (ts.isClassLike(n)) {
      const kw = n.getChildren(sf).find(c => c.kind === K.ClassKeyword);
      const head = `${k}@${s(n)} classKeyword@${s(kw)}`;
      if (n.typeParameters) { const lt = n.getChildren(sf).find(c => c.kind === K.LessThanToken); const gt = n.getChildren(sf).find(c => c.kind === K.GreaterThanToken); console.log(`   TypeParams owner ${head} lt@${s(lt)} gtEnd ${gt.end} [${n.typeParameters.map(p => `${t(p)} [${s(p)},${p.end})`).join(", ")}]`); }
      for (const h of n.heritageClauses || []) console.log(`   Heritage ${K[h.token]} owner ${head} clause [${s(h)},${h.end}) types ${h.types.map(x => `${K[x.kind]} [${s(x)},${x.end}) expr@${s(x.expression)} ${x.typeArguments ? `targs list [${x.typeArguments.pos},${x.typeArguments.end})` : "no targs"}`).join("; ")}`);
    }
    if ((ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n) || ts.isExpressionWithTypeArguments(n) && !ts.isHeritageClause(n.parent) || ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.typeArguments) {
      const ch = n.getChildren(sf); const lt = ch.find(c => c.kind === K.LessThanToken); const gt = ch.filter(c => c.kind === K.GreaterThanToken)[0];
      const target = n.expression || n.tag || n.tagName;
      console.log(`   TypeArgs ${k} [${s(n)},${n.end}) target ${K[target.kind]}@${s(target)} end ${target.end}${n.questionDotToken ? " questionDot@" + s(n.questionDotToken) : ""} lt@${lt ? s(lt) : "?"} gtEnd ${gt ? gt.end : "?"} list [${n.typeArguments.pos},${n.typeArguments.end}) [${n.typeArguments.map(a => `${K[a.kind]} [${s(a)},${a.end})`).join(", ")}]`);
    }
    if (ts.isDecorator(n)) console.log(`   Decorator [${s(n)},${n.end}) expr ${K[n.expression.kind]} [${s(n.expression)},${n.expression.end})`);
    if (n.kind === K.TypeAssertionExpression) console.log(`   TypeAssertion [${s(n)},${n.end}) type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) operand ${K[n.expression.kind]} [${s(n.expression)},${n.expression.end})`);
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) console.log(`   ${k} [${s(n)},${n.end}) operand ${K[n.expression.kind]} [${s(n.expression)},${n.expression.end}) type ${K[n.type.kind]} [${s(n.type)},${n.type.end}) ${t(n.type)}`);
    if (ts.isTypeAliasDeclaration(n)) console.log(`   TypeAlias [${s(n)},${n.end}) name@${s(n.name)} ${n.typeParameters ? `tparams list [${n.typeParameters.pos},${n.typeParameters.end}) ` : ""}type ${K[n.type.kind]} [${s(n.type)},${n.type.end})`);
    if (ts.isInterfaceDeclaration(n)) console.log(`   Interface [${s(n)},${n.end}) name@${s(n.name)} ${n.typeParameters ? `tparams list [${n.typeParameters.pos},${n.typeParameters.end}) ` : ""}${(n.heritageClauses || []).map(h => `${K[h.token]} [${s(h)},${h.end}) types ${h.types.map(x => `${K[x.kind]} [${s(x)},${x.end})`).join(",")}`).join(" ")} members list [${n.members.pos},${n.members.end})`);
    if (ts.isExportDeclaration(n)) console.log(`   ExportDeclaration [${s(n)},${n.end}) typeOnly ${n.isTypeOnly} module ${n.moduleSpecifier ? t(n.moduleSpecifier) + "@" + s(n.moduleSpecifier) : "-"}`);
    if (ts.isCatchClause(n) && n.variableDeclaration) {}
    ts.forEachChild(n, walk);
  })(sf);
}
