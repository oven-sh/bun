// Every comment of a file as the scanner of tsc 6.0.2 reads it: the trivia before every token of the parsed file.
// usage: node trivia-oracle.cjs <inputs.json>   (entries [name, loader, code]); prints the format of comments-oracle.cjs
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
function commentsOf(code, loader) {
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, true, kinds[loader]);
  const variant = loader === "ts" ? ts.LanguageVariant.Standard : ts.LanguageVariant.JSX;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, code);
  const found = [];
  const trivia = (pos, end) => {
    if (end <= pos) return;
    scanner.setText(code, pos, end - pos);
    for (let t = scanner.scan(); t !== K.EndOfFileToken; t = scanner.scan()) {
      if (t === K.SingleLineCommentTrivia || t === K.MultiLineCommentTrivia) {
        found.push([scanner.getTokenStart(), scanner.getTokenEnd(), t]);
      } else if (t !== K.WhitespaceTrivia && t !== K.NewLineTrivia && t !== K.ShebangTrivia && t !== K.ConflictMarkerTrivia) {
        throw new Error(`token ${K[t]} in trivia at ${scanner.getTokenStart()}`);
      }
    }
  };
  (function walk(node) {
    if (node.kind >= K.FirstJSDocNode && node.kind <= K.LastJSDocNode) return;
    const children = node.getChildren(sf);
    const isToken = node.kind >= K.FirstToken && node.kind <= K.LastToken || node.kind === K.Identifier || node.kind === K.PrivateIdentifier;
    if (children.length === 0 || isToken) {
      if (node.kind !== K.JsxText && node.kind !== K.JsxTextAllWhiteSpaces) trivia(node.pos, node.getStart(sf, false));
      return;
    }
    for (const child of children) walk(child);
  })(sf);
  found.sort((a, b) => a[0] - b[0]);
  return { found, diags: sf.parseDiagnostics.length };
}
module.exports = { commentsOf };
if (require.main === module) {
  const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  for (const [name, loader, code] of inputs) {
    const { found, diags } = commentsOf(code, loader);
    const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
    console.log(`--- ${name} [${loader}]${diags ? " PARSE-ERRORS=" + diags : ""}`);
    for (const [pos, end, t] of found) {
      const text = code.slice(pos, end);
      const kind = t === K.SingleLineCommentTrivia ? "line" : text.length >= 4 && text[2] === "*" && text[3] !== "/" ? "jsdoc" : "block";
      console.log(`${b(pos)}..${b(end)} ${kind} ${JSON.stringify(text)}`);
    }
  }
}
