// Proof harness for wrappers and parentheses.
// From the tsc tree of an input it makes (1) the tree of a parser that keeps no node for `as`, `satisfies`,
// `!`, `<T>x` and parentheses, (2) the wrapper records in the order such a parser makes them (operand first).
// Then it rebuilds the wrappers and the parentheses from (1), (2), the comment ranges and the source text,
// and compares kind, start and end of every rebuilt node with the tsc tree.
// usage: node rebuild.cjs inputs.json...      (each file: array of "source" or ["t.tsx", "source"])
//        node corpus.cjs <directory>...        (every .ts/.tsx/.mts/.cts file below)
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const WRAP = new Set([K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression]);
const isParen = n => n.kind === K.ParenthesizedExpression;
const isWs = c => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000;

function commentRanges(src, sf) {
  const out = [], seen = new Set();
  (function visit(n) {
    for (const r of [...(ts.getLeadingCommentRanges(src, n.pos) || []), ...(ts.getTrailingCommentRanges(src, n.end) || [])]) {
      const k = r.pos + ":" + r.end;
      if (!seen.has(k)) { seen.add(k); out.push([r.pos, r.end]); }
    }
    n.getChildren(sf).forEach(visit);
  })(sf);
  return out;
}

// prev(pos): offset of the last byte of the token before pos, or -1. next(pos): offset of the first byte of the token at or after pos.
function makeGaps(src, comments) {
  const endAt = new Map(comments.map(c => [c[1], c[0]])), startAt = new Map(comments.map(c => [c[0], c[1]]));
  return {
    prev(pos) { for (;;) { if (pos > 0 && isWs(src.charCodeAt(pos - 1))) pos--; else if (endAt.has(pos)) pos = endAt.get(pos); else return pos - 1; } },
    next(pos) { for (;;) { if (pos < src.length && isWs(src.charCodeAt(pos))) pos++; else if (startAt.has(pos)) pos = startAt.get(pos); else return pos; } },
  };
}

const leftOperand = n => {
  switch (n.kind) {
    case K.BinaryExpression: return n.left;
    case K.ConditionalExpression: return n.condition;
    case K.CallExpression: case K.PropertyAccessExpression: case K.ElementAccessExpression: return n.expression;
    case K.PostfixUnaryExpression: return n.operand;
    case K.TaggedTemplateExpression: return n.tag;
    default: return null;
  }
};
const rightOperand = n => {
  switch (n.kind) {
    case K.BinaryExpression: return n.right;
    case K.ConditionalExpression: return n.whenFalse;
    case K.PrefixUnaryExpression: return n.operand;
    case K.TypeOfExpression: case K.VoidExpression: case K.DeleteExpression: case K.AwaitExpression: case K.SpreadElement: return n.expression;
    case K.YieldExpression: return n.expression || null;
    case K.ArrowFunction: return ts.isBlock(n.body) ? null : n.body;
    case K.NewExpression: return n.arguments ? null : n.expression;
    default: return null;
  }
};

function run(src, file) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) return { skip: "tsc rejects: TS" + sf.parseDiagnostics[0].code };
  const gaps = makeGaps(src, commentRanges(src, sf));
  const erase = n => { while (isParen(n) || WRAP.has(n.kind)) n = n.expression; return n; };

  // Records, children before parents.
  const records = new Map();
  (function collect(n) {
    ts.forEachChild(n, collect);
    if (!WRAP.has(n.kind)) return;
    const operand = erase(n.expression);
    let rec;
    if (n.kind === K.NonNullExpression) rec = { kind: "NonNull", op: n.end - 1, end: n.end };
    else if (n.kind === K.TypeAssertionExpression) rec = { kind: "TypeAssertion", op: n.getStart(sf), end: n.end };
    else rec = { kind: n.kind === K.AsExpression ? "As" : "Satisfies", op: gaps.next(n.expression.end), end: n.end };
    if (!records.has(operand)) records.set(operand, []);
    records.get(operand).push(rec);
  })(sf);

  // The `(` that belongs to the parent when the operand is all that stands between the parent's parentheses.
  function ownOpen(parent, child) {
    if (!parent) return -1;
    const open = () => { const t = parent.getChildren(sf).find(c => c.kind === K.OpenParenToken); return t ? t.getStart(sf) : -1; };
    switch (parent.kind) {
      case K.CallExpression: case K.NewExpression:
        return parent.arguments && parent.arguments.includes(child) ? parent.arguments.pos - 1 : -1;
      case K.IfStatement: case K.WhileStatement: case K.DoStatement: case K.SwitchStatement: case K.WithStatement:
        return parent.expression === child ? open() : -1;
      case K.ForStatement: case K.ForInStatement: case K.ForOfStatement: case K.CatchClause: case K.ExternalModuleReference:
        return open();
      default: return -1;
    }
  }
  // A name, a label and a binding are not operands.
  const isName = (parent, c) => parent.name === c || parent.propertyName === c || parent.label === c || parent.tagName === c || ts.isBindingPattern(c);
  const isOperand = (parent, c) => !ts.isTypeNode(c) && !isName(parent, c) && ts.isExpression(c) && !(ts.isToken(c) && !ts.isIdentifier(c) && c.kind < K.FirstKeyword);

  const rebuilt = [], done = new Map();
  function lower(tscChild, parent) {
    const e = erase(tscChild);
    if (done.has(e)) return done.get(e);
    const l = leftOperand(e), r = rightOperand(e);
    let start = l ? lower(l, e).start : e.getStart(sf);
    let end = r ? lower(r, e).end : e.end;
    ts.forEachChild(e, c => { if (c !== l && c !== r && isOperand(e, c)) lower(c, e); });
    const own = ownOpen(parent, tscChild);
    // A child element of a JSX element stands between JSX text, not between tokens.
    const inText = parent && (parent.kind === K.JsxElement || parent.kind === K.JsxFragment)
      && (e.kind === K.JsxElement || e.kind === K.JsxSelfClosingElement || e.kind === K.JsxFragment);
    const ws = records.get(e) || [];
    for (let i = 0; ; ) {
      for (;;) {
        const o = gaps.prev(start), c = gaps.next(end);
        if (inText || o < 0 || src[o] !== "(" || src[c] !== ")" || o === own) break;
        start = o; end = c + 1;
        rebuilt.push("ParenthesizedExpression:" + start + ":" + end);
      }
      if (i === ws.length) break;
      const w = ws[i++];
      if (w.kind === "TypeAssertion") { if (end !== w.end) throw new Error("operand of the cast ends at " + end + ", record says " + w.end); start = w.op; }
      else { if (gaps.next(end) !== w.op) throw new Error(w.kind + " operator at " + w.op + " does not follow " + end); end = w.end; }
      rebuilt.push(w.kind + "Expression:" + start + ":" + end);
    }
    const range = { start, end };
    done.set(e, range);
    ts.forEachChild(e, c => { if (!done.has(erase(c))) drive(c, e); });
    return range;
  }
  function drive(n, parent) {
    if (parent && isName(parent, n)) { ts.forEachChild(n, c => drive(c, n)); return; }
    if (n.kind === K.ExpressionWithTypeArguments) { drive(n.expression, n); return; }
    if (ts.isTypeNode(n)) return;
    if (ts.isExpression(n)) { lower(n, parent); return; }
    ts.forEachChild(n, c => drive(c, n));
  }
  drive(sf, null);

  const expected = [];
  (function walk(n) {
    if (isParen(n) || WRAP.has(n.kind)) expected.push(K[n.kind] + ":" + n.getStart(sf) + ":" + n.end);
    ts.forEachChild(n, walk);
  })(sf);
  expected.sort(); rebuilt.sort();
  return { ok: JSON.stringify(expected) === JSON.stringify(rebuilt), expected, rebuilt };
}

module.exports = { run };
if (require.main === module) {
  let fail = 0, pass = 0, skipped = 0;
  for (const f of process.argv.slice(2)) {
    for (const item of JSON.parse(require("fs").readFileSync(f, "utf8"))) {
      const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
      let r;
      try { r = run(src, file); } catch (e) { r = { ok: false, error: String(e.message) }; }
      if (r.skip) { skipped++; console.log("SKIP " + JSON.stringify(src) + "  " + r.skip); }
      else if (r.ok) { pass++; console.log("PASS " + JSON.stringify(src) + "  " + r.rebuilt.join(" ")); }
      else { fail++; console.log("FAIL " + JSON.stringify(src) + "\n   expected " + (r.expected || []).join(" ") + "\n   rebuilt  " + (r.rebuilt || []).join(" ") + (r.error ? "\n   error " + r.error : "")); }
    }
  }
  console.log(`\npass ${pass} fail ${fail} skipped ${skipped}`);
  process.exitCode = fail ? 1 : 0;
}
