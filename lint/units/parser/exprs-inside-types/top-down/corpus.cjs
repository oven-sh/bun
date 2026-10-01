// Counts, per corpus, the sites where tsc reads an expression, an initializer, a decorator or a body inside type syntax.
// usage: node corpus.cjs <label> <dir or file> [<dir or file> ...]      (recursive; .ts .tsx .mts .cts .d.ts)
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const label = process.argv[2]; const roots = process.argv.slice(3);
const files = [];
function walk(p) {
  let st; try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) { if (/node_modules$|\/\.git$/.test(p) && !/typescript\/lib$/.test(p)) return; for (const e of fs.readdirSync(p)) walk(path.join(p, e)); }
  else if (/\.(ts|tsx|mts|cts)$/.test(p)) files.push(p);
}
roots.forEach(walk);
const K = ts.SyntaxKind;
const counts = {}; const examples = {}; const filesWith = {};
function hit(kind, sf, node) {
  counts[kind] = (counts[kind] || 0) + 1;
  (filesWith[kind] = filesWith[kind] || new Set()).add(sf.fileName);
  const ex = (examples[kind] = examples[kind] || []);
  if (ex.length < 6) ex.push(path.basename(sf.fileName) + ": " + node.getText(sf).replace(/\s+/g, " ").slice(0, 90));
}
function hasScopeMaker(n) {
  let found = false;
  (function v(x) {
    if (found) return;
    if (ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isClassExpression(x) || ts.isMethodDeclaration(x) || ts.isGetAccessor(x) || ts.isSetAccessor(x)) { found = true; return; }
    ts.forEachChild(x, v);
  })(n);
  return found;
}
function isEntityNameExpr(e) { return ts.isIdentifier(e) || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) && isEntityNameExpr(e.expression)); }
function classifyExpr(e) {
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e)) return "literal";
  if (ts.isPrefixUnaryExpression(e) && (e.operator === K.MinusToken || e.operator === K.PlusToken) && ts.isNumericLiteral(e.operand)) return "signed-number";
  if (isEntityNameExpr(e)) return "entity-name";
  return hasScopeMaker(e) ? "other-with-function-or-class" : "other-no-scope";
}
function inTypeMemberContainer(n) { return n.parent && (ts.isTypeLiteralNode(n.parent) || ts.isInterfaceDeclaration(n.parent)); }
function isTypeSignature(n) {
  return ts.isFunctionTypeNode(n) || ts.isConstructorTypeNode(n) || ts.isCallSignatureDeclaration(n) || ts.isConstructSignatureDeclaration(n) || ts.isMethodSignature(n) || ts.isIndexSignatureDeclaration(n)
    || ((ts.isGetAccessor(n) || ts.isSetAccessor(n)) && inTypeMemberContainer(n)) || n.kind === K.JSDocFunctionType;
}
function enclosingTypeSignature(n) { for (let p = n.parent; p; p = p.parent) { if (isTypeSignature(p)) return p; if (ts.isFunctionLike(p) || ts.isClassLike(p) || ts.isBlock(p)) return undefined; } }
let parsed = 0, withParseErrors = 0;
for (const f of files) {
  let text; try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ESNext, true);
  parsed++; const clean = sf.parseDiagnostics.length === 0; if (!clean) withParseErrors++;
  const sfx = clean ? "" : " (file has parse errors)";
  (function v(n) {
    if (ts.isComputedPropertyName(n)) {
      const owner = n.parent;
      if (owner && (ts.isPropertySignature(owner) || ts.isMethodSignature(owner) || ((ts.isGetAccessor(owner) || ts.isSetAccessor(owner)) && inTypeMemberContainer(owner)))) hit("A computed name of a type member: " + classifyExpr(n.expression) + sfx, sf, owner);
      else if (owner && ts.isBindingElement(owner) && enclosingTypeSignature(owner)) hit("C' computed key in a binding pattern of a type signature" + sfx, sf, owner);
    }
    if (ts.isParameter(n) && n.parent && isTypeSignature(n.parent)) {
      if (n.initializer) hit((ts.isIndexSignatureDeclaration(n.parent) ? "I index signature parameter initializer" : "B parameter initializer in a type signature") + ": " + (hasScopeMaker(n.initializer) ? "with function or class" : "no scope") + sfx, sf, n.parent);
      const decos = (ts.canHaveDecorators(n) && ts.getDecorators(n)) || (n.modifiers || []).filter(m => m.kind === K.Decorator);
      if (decos && decos.length) hit("H parameter decorator in a type signature" + sfx, sf, n.parent);
      if (ts.isIndexSignatureDeclaration(n.parent) && (n.questionToken || n.dotDotDotToken || (n.modifiers && n.modifiers.length) || n.parent.parameters.length !== 1 || !n.name || !ts.isIdentifier(n.name))) hit("I index signature parameter with ?, ..., modifier, pattern or count != 1" + sfx, sf, n.parent);
      if (n.name && !ts.isIdentifier(n.name)) hit("C binding pattern as parameter name in a type signature" + sfx, sf, n.parent);
    }
    if (ts.isBindingElement(n) && n.initializer && enclosingTypeSignature(n)) hit("C binding element initializer in a type signature: " + (hasScopeMaker(n.initializer) ? "with function or class" : "no scope") + sfx, sf, n);
    if (ts.isPropertySignature(n) && n.initializer) hit("D property signature initializer: " + (hasScopeMaker(n.initializer) ? "with function or class" : "no scope") + sfx, sf, n);
    if ((ts.isGetAccessor(n) || ts.isSetAccessor(n)) && inTypeMemberContainer(n)) hit(n.body ? "E accessor WITH body in a type literal or interface" + sfx : "E accessor signature (no body) in a type literal or interface" + sfx, sf, n);
    if (ts.isImportTypeNode(n) && n.attributes) for (const el of (n.attributes.elements || (n.attributes.attributes && n.attributes.attributes.elements) || [])) hit("F import type attribute value: " + (ts.isStringLiteral(el.value) ? "string literal" : "other expression") + sfx, sf, n);
    if (ts.isTypeParameterDeclaration(n) && n.expression) hit("G type parameter constraint that is an expression" + sfx, sf, n);
    if (ts.isHeritageClause(n)) for (const t of n.types) {
      const isIface = ts.isInterfaceDeclaration(n.parent); const impl = n.token === K.ImplementsKeyword;
      if (isIface || impl) hit((isIface ? "J interface heritage: " : "J class implements: ") + (isEntityNameExpr(t.expression) ? "entity name" : hasScopeMaker(t.expression) ? "other with function or class" : "other no scope") + sfx, sf, t);
    }
    ts.forEachChild(n, v);
  })(sf);
}
console.log(`## ${label}: ${parsed} files, ${withParseErrors} with parse diagnostics`);
for (const k of Object.keys(counts).sort()) { console.log(`${String(counts[k]).padStart(7)} in ${String(filesWith[k].size).padStart(5)} files  ${k}`); for (const e of examples[k].slice(0, process.env.EX ? 6 : 2)) console.log(`            e.g. ${e}`); }
