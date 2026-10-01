// Counts, in the given files, the places where Bun's parser reads `(` in prefix position: parenthesized
// expressions and parenthesized arrow parameter lists (async or not). usage: node paren-sites.cjs <file>...
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
let total = { files: 0, bytes: 0, tokens: 0, paren: 0, arrowParen: 0, asyncArrowParen: 0, asyncWord: 0, classMembers: 0, arrowExprBody: 0, comments: 0, lessThan: 0 };
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  total.files++; total.bytes += src.length;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
  (function visit(n) {
    if (n.kind === K.ParenthesizedExpression) total.paren++;
    if (n.kind === K.ArrowFunction) {
      const first = n.getFirstToken(sf);
      const isAsync = !!(n.modifiers && n.modifiers.some(m => m.kind === K.AsyncKeyword));
      const hasParen = n.getChildren(sf).some(c => c.kind === K.OpenParenToken);
      if (hasParen) { if (isAsync) total.asyncArrowParen++; else total.arrowParen++; }
      if (n.body.kind !== K.Block) total.arrowExprBody++;
    }
    if (ts.isClassElement(n)) total.classMembers++;
    if (n.kind === K.Identifier && n.text === "async") total.asyncWord++;
    if (n.getChildCount(sf) === 0) {
      total.tokens++;
      if (n.kind === K.LessThanToken) total.lessThan++;
    }
    n.getChildren(sf).forEach(visit);
  })(sf);
  // Comments: every range that the trivia scanner sees.
  const seen = new Set();
  (function visit(n) {
    for (const r of [...(ts.getLeadingCommentRanges(src, n.getFullStart()) || []), ...(ts.getTrailingCommentRanges(src, n.getEnd()) || [])]) seen.add(r.pos);
    n.getChildren(sf).forEach(visit);
  })(sf);
  total.comments += seen.size;
}
console.log(JSON.stringify(total));
