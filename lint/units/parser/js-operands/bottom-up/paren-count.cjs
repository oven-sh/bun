// usage: node paren-count.cjs <typescript.js> <file...> : how often a JavaScript file enters the parser's `(` prefix arm.
const ts = require(process.argv[2]);
const fs = require("fs");
for (const f of process.argv.slice(3)) {
  const text = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  let paren = 0, arrowParen = 0, asyncArrowParen = 0, nodes = 0, comments = 0, lt = 0;
  const walk = n => {
    nodes++;
    if (n.kind === ts.SyntaxKind.ParenthesizedExpression) paren++;
    if (n.kind === ts.SyntaxKind.BinaryExpression && (n.operatorToken.kind === ts.SyntaxKind.LessThanToken || n.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken)) lt++;
    if (n.kind === ts.SyntaxKind.ArrowFunction) {
      const first = n.getFirstToken(sf);
      const isAsync = (n.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword);
      const open = n.getChildren(sf).some(c => c.kind === ts.SyntaxKind.OpenParenToken);
      if (open) isAsync ? asyncArrowParen++ : arrowParen++;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, ts.LanguageVariant.JSX, text);
  let t; while ((t = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) comments++;
  console.log(JSON.stringify({ file: f, bytes: text.length, nodes, parenthesizedExpressions: paren, arrowParameterLists: arrowParen, asyncArrowParameterLists: asyncArrowParen, prefixOpenParen: paren + arrowParen, lessThanOperators: lt, comments, parseDiagnostics: sf.parseDiagnostics.length }));
}
