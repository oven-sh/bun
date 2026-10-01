// Every comment of a file as tsc 6.0.2 sees it: the leading and trailing comment ranges of every token.
const ts = require("/workspace/bun/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const utf8len = s => Buffer.byteLength(s, "utf8");
for (const [file, text] of inputs) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  const seen = new Map();
  const add = rs => { for (const r of rs || []) seen.set(r.pos, r); };
  // Text follows these tokens, not trivia: what looks like a comment there is JSX text.
  const textFollows = n => {
    const p = n.parent, K = ts.SyntaxKind;
    if (!p) return false;
    const inChildren = x => x.parent && (x.parent.kind === K.JsxElement || x.parent.kind === K.JsxFragment);
    if (n.kind === K.GreaterThanToken) {
      if (p.kind === K.JsxOpeningElement || p.kind === K.JsxOpeningFragment) return true;
      if (p.kind === K.JsxSelfClosingElement) return inChildren(p);
      if (p.kind === K.JsxClosingElement || p.kind === K.JsxClosingFragment) return inChildren(p.parent);
    }
    if (n.kind === K.CloseBraceToken && p.kind === K.JsxExpression) return inChildren(p);
    return false;
  };
  const visit = n => {
    if (n.kind === ts.SyntaxKind.JsxText) return;
    const kids = n.getChildren(sf).filter(c => c.kind < ts.SyntaxKind.FirstJSDocNode || c.kind > ts.SyntaxKind.LastJSDocNode);
    if (kids.length === 0) {
      add(ts.getLeadingCommentRanges(text, n.pos));
      if (!textFollows(n)) add(ts.getTrailingCommentRanges(text, n.end));
    }
    for (const c of kids) visit(c);
  };
  visit(sf);
  add(ts.getLeadingCommentRanges(text, 0));
  const list = [...seen.values()].sort((a, b) => a.pos - b.pos).map(r => {
    const t = text.slice(r.pos, r.end);
    const k = r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? "Line" : (t.length >= 4 && t[2] === "*" && t[3] !== "/") ? "JsDoc" : "Block";
    return `${k}[${utf8len(text.slice(0, r.pos))},${utf8len(text.slice(0, r.end))}) ${JSON.stringify(t)}`;
  });
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}`);
  console.log(`== ${file}  ${JSON.stringify(text)}${diags.length ? "  PARSE-DIAGS " + diags.join(",") : ""}`);
  for (const l of list) console.log("   " + l);
}
