// node comments-oracle.cjs comments-inputs.json  ->  per input: name, then start..end (UTF-8 byte offsets) kind text
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
function kindOf(text) {
  if (text[1] === "/") return "line";
  return text.length >= 4 && text[2] === "*" && text[3] !== "/" ? "jsdoc" : "block";
}
for (const [name, loader, code] of inputs) {
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, true, kinds[loader]);
  const found = new Map();
  const add = r => { if (r) for (const c of r) found.set(c.pos, c.end); };
  const isText = k => k === ts.SyntaxKind.JsxText || k === ts.SyntaxKind.JsxTextAllWhiteSpaces;
  (function walk(node) {
    const children = node.getChildren(sf);
    if (children.length === 0 || node.kind >= ts.SyntaxKind.FirstToken && node.kind <= ts.SyntaxKind.LastToken) {
      if (!isText(node.kind)) {
        add(ts.getLeadingCommentRanges(code, node.pos));
        add(ts.getTrailingCommentRanges(code, node.pos));
        add(ts.getTrailingCommentRanges(code, node.end));
        add(ts.getLeadingCommentRanges(code, node.end));
      }
      return;
    }
    for (const c of children) if (c.kind !== ts.SyntaxKind.JSDoc) walk(c);
  })(sf);
  // Comments that sit next to JSX text are reported from the text side: drop ranges inside a JsxText token.
  const texts = [];
  (function collect(node) { if (isText(node.kind)) texts.push([node.pos, node.end]); node.forEachChild(collect); })(sf);
  const list = [...found].filter(([p]) => !texts.some(([a, b]) => p >= a && p < b)).sort((a, b) => a[0] - b[0]);
  const diags = sf.parseDiagnostics.length;
  console.log(`--- ${name} [${loader}]${diags ? " PARSE-ERRORS=" + diags : ""}`);
  const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
  for (const [pos, end] of list) console.log(`${b(pos)}..${b(end)} ${kindOf(code.slice(pos, end))} ${JSON.stringify(code.slice(pos, end))}`);
}
