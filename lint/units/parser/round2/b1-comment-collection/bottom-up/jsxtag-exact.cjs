// Counts the comments that Bun's next_inside_jsx_element reads: the trivia before a token of a JSX tag that this scanner produces.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
function count(file, text) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
  const found = [];
  const trivia = (pos, end) => {
    scanner.setText(text, pos, end - pos);
    for (let t = scanner.scan(); t !== K.EndOfFileToken; t = scanner.scan())
      if (t === K.SingleLineCommentTrivia || t === K.MultiLineCommentTrivia) found.push(scanner.getTokenStart());
  };
  const isTag = n => [K.JsxOpeningElement, K.JsxSelfClosingElement, K.JsxClosingElement, K.JsxOpeningFragment, K.JsxClosingFragment].includes(n.kind);
  // walk the tokens of a tag: jsx = whether the JSX scanner produced the token
  function tag(node) {
    const tokens = [];
    (function leaves(n, inJsx) {
      const kids = n.getChildren(sf);
      if (kids.length === 0 || n.kind === K.Identifier) { tokens.push([n, inJsx]); return; }
      if (n.kind === K.JsxExpression || n.kind === K.JsxSpreadAttribute) {
        // "{" by the JSX scanner, the rest by next()
        kids.forEach((c, i) => leaves(c, inJsx && i === 0));
        return;
      }
      if (n.kind === K.SyntaxList && n.parent === node && node.typeArguments && kids.length && kids[0] === node.typeArguments[0]) { kids.forEach(c => leaves(c, false)); return; }
      for (const c of kids) leaves(c, inJsx);
    })(node, true);
    tokens.forEach(([t, inJsx], i) => {
      if (i === 0) return; // "<" is read outside the tag
      // ">" that closes type arguments is read by next()
      const closesTypeArguments = node.typeArguments && t.kind === K.GreaterThanToken && t.pos >= node.typeArguments.end && t.pos <= node.typeArguments.end + 0 && t !== tokens[tokens.length - 1][0];
      if (inJsx && !closesTypeArguments) trivia(t.pos, t.getStart(sf, false));
    });
  }
  (function visit(n) { if (isTag(n)) tag(n); ts.forEachChild(n, visit); })(sf);
  return [...new Set(found)].sort((a, b) => a - b).map(p => sf.getLineAndCharacterOfPosition(p).line + 1);
}
for (const file of process.argv.slice(2)) {
  const lines = count(file, fs.readFileSync(file, "utf8"));
  console.log(file.split("/").slice(-1)[0], lines.length, JSON.stringify(lines));
}
