// Counts, with tsc 6.0.2, how often each "expression inside type syntax" site occurs in real files.
// usage: node freq.cjs <label>=<dir> ...      (walks *.ts, *.tsx, *.d.ts, *.mts, *.cts)
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const path = require("path");
function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") yield* walk(p); }
    else if (/\.(d\.)?[mc]?tsx?$/.test(e.name)) yield p;
  }
}
const K = ts.SyntaxKind;
const inTypeMember = n => ts.isTypeLiteralNode(n.parent) || ts.isInterfaceDeclaration(n.parent) || ts.isMappedTypeNode(n.parent);
function isSignatureWithoutBodySlot(n) {
  // nodes whose parameters are read by the type grammar of Bun (not by parse_fn)
  return ts.isFunctionTypeNode(n) || ts.isConstructorTypeNode(n) || ts.isCallSignatureDeclaration(n) || ts.isConstructSignatureDeclaration(n)
    || ts.isMethodSignature(n) || ts.isIndexSignatureDeclaration(n)
    || ((ts.isGetAccessor(n) || ts.isSetAccessor(n)) && inTypeMember(n));
}
function exprClass(e) {
  if (ts.isIdentifier(e)) return "identifier";
  if (ts.isPropertyAccessExpression(e)) { let x = e; while (ts.isPropertyAccessExpression(x)) x = x.expression; return ts.isIdentifier(x) ? "dotted-name" : "other:" + K[e.kind]; }
  if (ts.isStringLiteralLike(e)) return "string-literal";
  if (ts.isNumericLiteral(e)) return "numeric-literal";
  if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return (e.operator === K.MinusToken ? "minus" : "plus") + "-numeric";
  return "other:" + K[e.kind];
}
for (const arg of process.argv.slice(2)) {
  const [label, dir] = arg.split("=");
  const c = {}; const ex = {};
  const bump = (k, sf, n) => { c[k] = (c[k] || 0) + 1; if (!ex[k] && n) ex[k] = path.basename(sf.fileName) + ":" + (sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1); };
  let files = 0, bytes = 0, parseErr = 0;
  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
    files++; bytes += text.length; if (sf.parseDiagnostics.length) parseErr++;
    const stack = [sf];
    while (stack.length) {
      const n = stack.pop();
      if (ts.isComputedPropertyName(n)) {
        const owner = n.parent;
        if (inTypeMember(owner)) bump("computed name in type member: " + exprClass(n.expression), sf, n);
        else if (ts.isBindingElement(owner)) { let p = owner; while (p && !ts.isParameter(p) && !ts.isVariableDeclaration(p)) p = p.parent; if (p && ts.isParameter(p) && isSignatureWithoutBodySlot(p.parent)) bump("computed key in binding pattern of a signature parameter", sf, n); }
      }
      if (ts.isParameter(n) && isSignatureWithoutBodySlot(n.parent)) {
        bump("signature parameter (all)", sf, null);
        if (n.initializer) bump("signature parameter with initializer", sf, n);
        if (!ts.isIdentifier(n.name)) bump("signature parameter with binding pattern", sf, n);
        if (ts.canHaveDecorators(n) && ts.getDecorators(n)?.length) bump("signature parameter with decorator", sf, n);
        if (n.modifiers?.some(m => m.kind !== K.Decorator)) bump("signature parameter with modifier", sf, n);
      }
      if (ts.isBindingElement(n) && n.initializer) { let p = n; while (p && !ts.isParameter(p) && !ts.isVariableDeclaration(p)) p = p.parent; if (p && ts.isParameter(p) && isSignatureWithoutBodySlot(p.parent)) bump("binding element with initializer in a signature parameter", sf, n); }
      if (ts.isPropertySignature(n)) { bump("property signature (all)", sf, null); if (n.initializer) bump("property signature with initializer", sf, n); }
      if ((ts.isGetAccessor(n) || ts.isSetAccessor(n)) && inTypeMember(n)) { bump("accessor in type member (all)", sf, null); if (n.body) bump("accessor in type member with body", sf, n); }
      if (ts.isTypeParameterDeclaration(n)) { bump("type parameter (all)", sf, null); if (n.expression) bump("type parameter with expression constraint", sf, n); }
      if (ts.isImportTypeNode(n)) { bump("import type (all)", sf, null); if (n.attributes) { bump("import type with attributes", sf, n); for (const el of n.attributes.elements) if (!ts.isStringLiteral(el.value)) bump("import attribute value that is not a string literal", sf, el); } }
      if (ts.isHeritageClause(n)) {
        const iface = ts.isInterfaceDeclaration(n.parent);
        if (iface || n.token === K.ImplementsKeyword) for (const t of n.types) {
          bump("type heritage entry (all)", sf, null);
          const cls = exprClass(t.expression);
          if (cls !== "identifier" && cls !== "dotted-name") bump("type heritage entry that is not an entity name: " + cls, sf, t);
        }
      }
      ts.forEachChild(n, child => { stack.push(child); });
    }
  }
  console.log(`## ${label}: ${files} files, ${(bytes / 1e6).toFixed(2)} MB, ${parseErr} with parse diagnostics`);
  for (const k of Object.keys(c).sort()) console.log(`  ${String(c[k]).padStart(7)}  ${k}${ex[k] ? "   e.g. " + ex[k] : ""}`);
}
