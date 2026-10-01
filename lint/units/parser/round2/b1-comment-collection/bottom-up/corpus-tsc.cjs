// tsc 6.0.2 side of the corpus comparison: for every file of the list, its parse diagnostics count and every comment (UTF-8 byte offsets, kind).
// usage: node corpus-tsc.cjs <root> <out.tsv>      list = git ls-files test src/js, by extension
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const { execFileSync } = require("child_process");
const K = ts.SyntaxKind;
const root = process.argv[2];
const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "test", "src/js"], { maxBuffer: 1 << 28 }).toString().split("\0")
  .filter(f => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));
const kindOf = f => /\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.jsx$/.test(f) ? ts.ScriptKind.JSX : /\.(js|mjs|cjs)$/.test(f) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
const out = fs.openSync(process.argv[3], "w");
let total = 0, failed = 0, thrown = 0, withDiags = 0;
for (const file of files) {
  let text;
  try { text = fs.readFileSync(root + "/" + file, "utf8"); } catch { continue; }
  const scriptKind = kindOf(file);
  let line;
  try {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
    const variant = scriptKind === ts.ScriptKind.TS ? ts.LanguageVariant.Standard : ts.LanguageVariant.JSX;
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, text);
    const found = [];
    const trivia = (pos, end) => {
      if (end <= pos) return;
      scanner.setText(text, pos, end - pos);
      for (let t = scanner.scan(); t !== K.EndOfFileToken; t = scanner.scan()) {
        if (t === K.SingleLineCommentTrivia || t === K.MultiLineCommentTrivia) found.push([scanner.getTokenStart(), scanner.getTokenEnd(), t]);
        else if (t !== K.WhitespaceTrivia && t !== K.NewLineTrivia && t !== K.ShebangTrivia && t !== K.ConflictMarkerTrivia) throw new Error(`token ${K[t]} in trivia at ${scanner.getTokenStart()}`);
      }
    };
    const stack = [sf];
    while (stack.length) {
      const node = stack.pop();
      if (node.kind >= K.FirstJSDocNode && node.kind <= K.LastJSDocNode) continue;
      const isToken = node.kind >= K.FirstToken && node.kind <= K.LastToken || node.kind === K.Identifier || node.kind === K.PrivateIdentifier;
      const children = isToken ? [] : node.getChildren(sf);
      if (children.length === 0) {
        if (node.kind !== K.JsxText && node.kind !== K.JsxTextAllWhiteSpaces) trivia(node.pos, node.getStart(sf, false));
        continue;
      }
      for (const child of children) stack.push(child);
    }
    found.sort((a, b) => a[0] - b[0]);
    // UTF-16 offsets to UTF-8 offsets in one pass
    const map = new Uint32Array(text.length + 1);
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      map[i] = bytes;
      const c = text.charCodeAt(i);
      if (c < 0x80) bytes += 1; else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; map[i + 1] = bytes; i++; }
      else bytes += 3;
    }
    map[text.length] = bytes;
    const list = found.map(([pos, end, t]) => {
      const k = t === K.SingleLineCommentTrivia ? "L" : text.charCodeAt(pos + 2) === 42 && text.charCodeAt(pos + 3) !== 47 && end - pos >= 4 ? "J" : "B";
      return `${map[pos]}:${map[end]}:${k}`;
    });
    total += list.length;
    if (sf.parseDiagnostics.length) withDiags++;
    line = `${file}\t${sf.parseDiagnostics.length}\t${list.join(" ")}\n`;
  } catch (e) {
    thrown++;
    line = `${file}\tTHROW\t${String(e.message).slice(0, 80)}\n`;
  }
  fs.writeSync(out, line);
}
fs.closeSync(out);
console.log(JSON.stringify({ files: files.length, comments: total, withParseDiagnostics: withDiags, thrown }));
