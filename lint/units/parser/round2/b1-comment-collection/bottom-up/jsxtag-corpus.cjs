const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const { execFileSync } = require("child_process");
const K = ts.SyntaxKind;
const root = "/workspace/wt/parser";
const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "test", "src/js"], { maxBuffer: 1 << 28 }).toString().split("\0").filter(f => /\.(tsx|jsx|js|mjs|cjs)$/.test(f));
let filesWithJsx = 0, tags = 0, comments = 0, filesWithComments = 0, skipped = 0;
for (const file of files) {
  let text; try { text = fs.readFileSync(root + "/" + file, "utf8"); } catch { continue; }
  if (text.length > 2e6 || !/<\/|\/>/.test(text)) continue;
  let sf;
  try { sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX); } catch { skipped++; continue; }
  if (sf.parseDiagnostics.length) { skipped++; continue; }
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
  const found = new Set(); let fileTags = 0;
  const trivia = (pos, end) => { if (end <= pos) return; scanner.setText(text, pos, end - pos); for (let t = scanner.scan(); t !== K.EndOfFileToken; t = scanner.scan()) if (t === K.SingleLineCommentTrivia || t === K.MultiLineCommentTrivia) found.add(scanner.getTokenStart()); };
  const isTag = n => n.kind === K.JsxOpeningElement || n.kind === K.JsxSelfClosingElement || n.kind === K.JsxClosingElement || n.kind === K.JsxOpeningFragment || n.kind === K.JsxClosingFragment;
  const tag = node => {
    const tokens = [];
    (function leaves(n, inJsx) {
      const kids = n.getChildren(sf);
      if (kids.length === 0 || n.kind === K.Identifier) { tokens.push([n, inJsx]); return; }
      if (n.kind === K.JsxExpression || n.kind === K.JsxSpreadAttribute) { kids.forEach((c, i) => leaves(c, inJsx && i === 0)); return; }
      if (n.kind === K.SyntaxList && n.parent === node && node.typeArguments && kids.length && kids[0] === node.typeArguments[0]) { kids.forEach(c => leaves(c, false)); return; }
      for (const c of kids) leaves(c, inJsx);
    })(node, true);
    tokens.forEach(([t, inJsx], i) => { if (i > 0 && inJsx) trivia(t.pos, t.getStart(sf, false)); });
  };
  try { (function visit(n) { if (isTag(n)) { fileTags++; tag(n); } ts.forEachChild(n, visit); })(sf); } catch { skipped++; continue; }
  if (fileTags) { filesWithJsx++; tags += fileTags; comments += found.size; if (found.size) filesWithComments++; }
}
console.log(JSON.stringify({ candidates: files.length, filesWithJsx, tags, commentsInTags: comments, filesWithComments, skipped }));
