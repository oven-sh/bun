// Checks the rule for a JSX element that Bun keeps as a direct child of a JSX element:
// the parentheses found by growth are real only when the outermost one stands in an expression container.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const K = ts.SyntaxKind;
const isWs = c => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;
let files = 0, checked = 0, bad = 0, real = 0, text = 0;
function commentRanges(src, sf) {
  const out = [], seen = new Set();
  (function visit(n) {
    for (const r of [...(ts.getLeadingCommentRanges(src, n.pos) || []), ...(ts.getTrailingCommentRanges(src, n.end) || [])]) {
      const k = r.pos + ":" + r.end; if (!seen.has(k)) { seen.add(k); out.push([r.pos, r.end]); }
    }
    n.getChildren(sf).forEach(visit);
  })(sf);
  return out;
}
function run(f) {
  const src = fs.readFileSync(f, "utf8"); if (src.length > 400000) return;
  const sf = ts.createSourceFile("t.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (sf.parseDiagnostics.length) return;
  files++;
  const cs = commentRanges(src, sf);
  const endAt = new Map(cs.map(c => [c[1], c[0]])), startAt = new Map(cs.map(c => [c[0], c[1]]));
  const prev = pos => { for (;;) { if (pos > 0 && isWs(src.charCodeAt(pos - 1))) pos--; else if (endAt.has(pos)) pos = endAt.get(pos); else return pos - 1; } };
  const next = pos => { for (;;) { if (pos < src.length && isWs(src.charCodeAt(pos))) pos++; else if (startAt.has(pos)) pos = startAt.get(pos); else return pos; } };
  const isEl = n => n.kind === K.JsxElement || n.kind === K.JsxSelfClosingElement || n.kind === K.JsxFragment;
  (function walk(n) {
    ts.forEachChild(n, walk);
    if (!isEl(n)) return;
    // Is it, after erasing containers and parentheses, a direct child of a JSX element?
    let p = n.parent, parens = 0, inContainer = false;
    while (p.kind === K.ParenthesizedExpression) { parens++; p = p.parent; }
    if (p.kind === K.JsxExpression && !p.dotDotDotToken) { inContainer = true; p = p.parent; } else if (parens) return;
    if (p.kind !== K.JsxElement && p.kind !== K.JsxFragment) return;
    checked++;
    let s = n.getStart(sf), e = n.end, k = 0;
    for (;;) { const o = prev(s), c = next(e); if (o < 0 || src[o] !== "(" || src[c] !== ")") break; s = o; e = c + 1; k++; }
    const container = src[prev(s)] === "{" && src[next(e)] === "}";
    const derived = container ? k : 0;
    if (derived !== parens || container !== inContainer) { bad++; if (bad < 10) console.log("BAD", f, n.getStart(sf), { k, container, parens, inContainer }); }
    if (container) real += k; else text += k;
  })(sf);
}
function walkDir(d) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walkDir(f); }
    else if (/\.(tsx|jsx)$/.test(e.name)) { try { run(f); } catch (err) { console.log("ERR", f, err.message); } } }
}
for (const d of process.argv.slice(2)) walkDir(d);
console.log(`files ${files} jsx child elements ${checked} mismatches ${bad}; real parens ${real}, text parens ${text}`);
