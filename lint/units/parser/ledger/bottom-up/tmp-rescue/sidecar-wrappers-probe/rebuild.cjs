// Proof harness. From the tsc tree of an input it makes (1) the tree a parser that drops wrappers keeps,
// (2) the wrapper records in the order the parser would make them, then rebuilds the wrappers and the
// parentheses from (1), (2) and the source text only, and compares the result with the tsc tree.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const WRAP = new Set([K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression]);
const isParen = n => n.kind === K.ParenthesizedExpression;

function comments(src, sf) {
  // Every comment of the file, from the scanner of tsc, as [start,end).
  const out = [];
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, sf.languageVariant, src);
  // Walk the tokens of the tree: trivia is what lies between them.
  const seen = new Set();
  function visit(n) {
    for (const r of [...(ts.getLeadingCommentRanges(src, n.pos) || []), ...(ts.getTrailingCommentRanges(src, n.end) || [])]) {
      const k = r.pos + ":" + r.end;
      if (!seen.has(k)) { seen.add(k); out.push([r.pos, r.end]); }
    }
    n.getChildren(sf).forEach(visit);
  }
  visit(sf);
  return out.sort((a, b) => a[0] - b[0]);
}
const isWs = c => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;
function makeGaps(src, cm) {
  const endAt = new Map(cm.map(c => [c[1], c[0]]));
  const startAt = new Map(cm.map(c => [c[0], c[1]]));
  return {
    // Offset of the last byte of the token before `pos`, or -1.
    prev(pos) {
      for (;;) {
        if (pos > 0 && isWs(src.charCodeAt(pos - 1))) { pos--; continue; }
        if (endAt.has(pos)) { pos = endAt.get(pos); continue; }
        return pos - 1;
      }
    },
    // Offset of the first byte of the token at or after `pos`, or src.length.
    next(pos) {
      for (;;) {
        if (pos < src.length && isWs(src.charCodeAt(pos))) { pos++; continue; }
        if (startAt.has(pos)) { pos = startAt.get(pos); continue; }
        return pos;
      }
    },
  };
}

function run(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) return { skip: "tsc rejects: TS" + sf.parseDiagnostics[0].code };
  const gaps = makeGaps(src, comments(src, sf));
  const erase = n => { while (isParen(n) || WRAP.has(n.kind)) n = n.expression; return n; };

  // (2) records, children before parents: the order of creation in a parser that parses the operand first.
  const records = new Map(); // erased operand -> list
  function collect(n) {
    ts.forEachChild(n, collect);
    if (!WRAP.has(n.kind)) return;
    const operand = erase(n.expression);
    let rec;
    if (n.kind === K.NonNullExpression) rec = { kind: "NonNull", op: n.end - 1, end: n.end };
    else if (n.kind === K.TypeAssertionExpression) rec = { kind: "TypeAssertion", op: n.getStart(sf), end: n.end, type: [n.type.getStart(sf), n.type.end] };
    else rec = { kind: n.kind === K.AsExpression ? "As" : "Satisfies", op: gaps.next(n.expression.end), end: n.end, type: [n.type.getStart(sf), n.type.end] };
    if (!records.has(operand)) records.set(operand, []);
    records.get(operand).push(rec);
  }
  collect(sf);

  // Own parentheses of a parent around its only operand: never a parenthesized expression.
  function ownOpen(parent, child) {
    if (!parent) return -1;
    const open = () => { const t = parent.getChildren(sf).find(c => c.kind === K.OpenParenToken); return t ? t.getStart(sf) : -1; };
    switch (parent.kind) {
      case K.CallExpression: case K.NewExpression:
        return parent.arguments && parent.arguments.includes(child) ? parent.arguments.pos - 1 : -1;
      case K.IfStatement: case K.WhileStatement: case K.DoStatement: case K.SwitchStatement: case K.WithStatement:
        return parent.expression === child ? open() : -1;
      case K.ForStatement: case K.ForInStatement: case K.ForOfStatement: case K.CatchClause:
        return open();
      case K.ExternalModuleReference:
        return open();
      default: return -1;
    }
  }
  const leftOf = n => {
    switch (n.kind) {
      case K.BinaryExpression: return n.left;
      case K.ConditionalExpression: return n.condition;
      case K.CallExpression: case K.PropertyAccessExpression: case K.ElementAccessExpression: return n.expression;
      case K.PostfixUnaryExpression: return n.operand;
      case K.TaggedTemplateExpression: return n.tag;
      default: return null;
    }
  };
  const rightOf = n => {
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

  const rebuilt = []; // [kind, start, end] of every wrapper and parenthesis that the rebuild makes
  // `tscChild` is the node that tsc has in this slot, `parent` its tsc parent.
  function lower(tscChild, parent) {
    const e = erase(tscChild);
    // Token range of the node itself.
    const l = leftOf(e), r = rightOf(e);
    let start = l ? lower(l, e).start : e.getStart(sf);
    let end = r ? lower(r, e).end : e.end;
    // Visit the other operands too.
    ts.forEachChild(e, c => { if (c !== l && c !== r && isExpressionSlot(e, c)) lower(c, e); });
    const own = ownOpen(parent, tscChild);
    // A child element of a JSX element lies between JSX text: what is next to it is text, not tokens.
    const noParens = parent && (parent.kind === K.JsxElement || parent.kind === K.JsxFragment)
      && (e.kind === K.JsxElement || e.kind === K.JsxSelfClosingElement || e.kind === K.JsxFragment);
    const ws = records.get(e) || [];
    let i = 0;
    for (;;) {
      for (;;) {
        const o = gaps.prev(start), c = gaps.next(end);
        if (noParens || o < 0 || src[o] !== "(" || src[c] !== ")" || o === own) break;
        start = o; end = c + 1;
        rebuilt.push(["ParenthesizedExpression", start, end]);
      }
      if (i === ws.length) break;
      const w = ws[i++];
      if (w.kind === "TypeAssertion") { if (end !== w.end) throw new Error("cast operand end " + end + " != " + w.end); start = w.op; }
      else { if (gaps.next(end) !== w.op) throw new Error(w.kind + " operator at " + w.op + " does not follow " + end); end = w.end; }
      rebuilt.push([w.kind + "Expression", start, end]);
    }
    return { start, end };
  }
  // A name, a label and a binding are not operands: the parentheses next to them belong to the parent.
  function isName(parent, c) {
    return parent.name === c || parent.propertyName === c || parent.label === c || parent.tagName === c
      || ts.isBindingPattern(c) || ts.isParameter(c) && false;
  }
  function isExpressionSlot(parent, c) {
    if (ts.isTypeNode(c) || isName(parent, c) || ts.isToken(c) && !ts.isIdentifier(c) && c.kind < K.FirstKeyword) return false;
    return ts.isExpression(c);
  }
  // Drive from every slot of the tree that holds an expression and is not inside another expression.
  function drive(n, parent) {
    if (parent && isName(parent, n)) { ts.forEachChild(n, c => drive(c, n)); return; }
    if (n.kind === K.ExpressionWithTypeArguments) { drive(n.expression, n); return; }
    if (ts.isTypeNode(n)) return;
    if (ts.isExpression(n)) { lower(n, parent); return; }
    ts.forEachChild(n, c => drive(c, n));
  }
  function isRootSlot(parent, n) { return false; }
  // lower() recurses through expressions only. Statements and declarations inside them are driven here.
  const done = new Set();
  const lower0 = lower;
  lower = function (tscChild, parent) {
    const e = erase(tscChild);
    if (done.has(e)) return e.__r;
    done.add(e);
    const r = lower0(tscChild, parent);
    e.__r = r;
    // Parts of the node that are not expressions: parameters, bodies, members.
    ts.forEachChild(e, c => { if (!done.has(erase(c))) drive(c, e); });
    return r;
  };
  drive(sf, null);

  const expected = [];
  (function walk(n) {
    if (isParen(n) || WRAP.has(n.kind)) expected.push([K[n.kind].replace("TypeAssertionExpression", "TypeAssertionExpression"), n.getStart(sf), n.end]);
    ts.forEachChild(n, walk);
  })(sf);
  const norm = a => a.map(x => x.join(":")).sort();
  const A = norm(expected), B = norm(rebuilt);
  return { ok: JSON.stringify(A) === JSON.stringify(B), expected: A, rebuilt: B };
}

module.exports = { run };
if (require.main !== module) return;
let fail = 0, pass = 0, skipped = 0;
for (const f of process.argv.slice(2)) {
  for (const item of JSON.parse(require("fs").readFileSync(f, "utf8"))) {
    const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
    let r;
    try { r = run(src, file); } catch (e) { r = { ok: false, error: String(e.message) }; }
    if (r.skip) { skipped++; console.log("SKIP " + JSON.stringify(src) + "  " + r.skip); continue; }
    if (r.ok) { pass++; console.log("PASS " + JSON.stringify(src) + "  " + r.rebuilt.join(" ")); }
    else { fail++; console.log("FAIL " + JSON.stringify(src) + "\n   expected " + (r.expected || []).join(" ") + "\n   rebuilt  " + (r.rebuilt || []).join(" ") + (r.error ? "\n   error " + r.error : "")); }
  }
}
console.log(`\npass ${pass} fail ${fail} skipped ${skipped}`);
