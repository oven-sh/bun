// Every comment of a source as tsc 6.0.2 sees it: the leading and trailing comment ranges of every token, in UTF-8 byte offsets.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
const scriptKinds = { ts: ts.ScriptKind.TS, dts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const fileNames = { ts: "a.ts", dts: "a.d.ts", tsx: "a.tsx", js: "a.js", jsx: "a.jsx" };

function loaderOf(file) {
  if (/\.d\.ts$/.test(file)) return "dts";
  const m = /\.(tsx|ts|jsx|js)$/.exec(file);
  return m ? m[1] : "ts";
}

function commentsOf(loader, text) {
  const sf = ts.createSourceFile(fileNames[loader], text, ts.ScriptTarget.ESNext, true, scriptKinds[loader]);
  const seen = new Map();
  const add = rs => { for (const r of rs || []) seen.set(r.pos, r); };
  // Text follows these tokens, not trivia: what looks like a comment there is JSX text.
  const textFollows = n => {
    const p = n.parent;
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
    if (n.kind === K.JsxText) return;
    const kids = n.getChildren(sf).filter(c => c.kind < K.FirstJSDocNode || c.kind > K.LastJSDocNode);
    if (kids.length === 0) {
      add(ts.getLeadingCommentRanges(text, n.pos));
      if (!textFollows(n)) add(ts.getTrailingCommentRanges(text, n.end));
    }
    for (const c of kids) visit(c);
  };
  visit(sf);
  const leading = ts.getLeadingCommentRanges(text, 0) || [];
  add(leading);
  const b = (() => {
    // UTF-16 index -> UTF-8 byte offset
    const map = new Uint32Array(text.length + 1);
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      map[i] = bytes;
      const c = text.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { bytes += 4; map[i + 1] = bytes; i++; }
      else bytes += 3;
    }
    map[text.length] = bytes;
    return i => map[i];
  })();
  const list = [...seen.values()].sort((x, y) => x.pos - y.pos).map(r => {
    const t = text.slice(r.pos, r.end);
    const kind = r.kind === K.SingleLineCommentTrivia ? "line" : t.length >= 4 && t[2] === "*" && t[3] !== "/" ? "jsdoc" : "block";
    return `${b(r.pos)}-${b(r.end)}:${kind}`;
  });
  return { list, leading: leading.length, diags: sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}`) };
}

module.exports = { commentsOf, loaderOf };
