// Model of what a lint parse of Bun records for wrappers, and of the cold rebuild that turns the records,
// the source text and the comment ranges back into the tsc nesting (ParenthesizedExpression, AsExpression,
// SatisfiesExpression, NonNullExpression, TypeAssertion, ExpressionWithTypeArguments of an instantiation expression).
// The tsc tree stands in for Bun's tree: wrapper nodes are erased, records carry the operand that Bun has in scope.
//   MODE=D2 (default): the cast record is made after the unary operand was read (operand = top of the postfix chain).
//   MODE=D1: the cast record is made where the code makes it today (operand = what parse_prefix returned), before the
//            records of the postfix chain; the rebuild keeps casts pending until the chain ends.
// Slot rules use only what Bun's tree can tell: the ( of a call is the token after the callee (after ?. and type
// arguments), the head of if / while / do / switch / with owns the outermost pair, a child of a JSX element is in a
// container only when { and } are the tokens around it.
// usage: node bunmodel.cjs inputs.json...   |   node bunmodel.cjs --dir <directory>...   (JS=1: .js files, MODE=D1|D2)
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const K = ts.SyntaxKind;
const MODE = process.env.MODE || "D2";
const WRAP = new Set([K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression]);
const isParen = n => n.kind === K.ParenthesizedExpression;
const isInst = n => n.kind === K.ExpressionWithTypeArguments && n.parent && n.parent.kind !== K.HeritageClause;
const isWrap = n => WRAP.has(n.kind) || isInst(n);
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
// prevEnd(pos): exclusive end of the token before pos. next(pos): start of the token at or after pos.
function makeGaps(src, comments) {
  const endAt = new Map(comments.map(c => [c[1], c[0]])), startAt = new Map(comments.map(c => [c[0], c[1]]));
  return {
    prevEnd(pos) { for (;;) { if (pos > 0 && isWs(src.charCodeAt(pos - 1))) pos--; else if (endAt.has(pos)) pos = endAt.get(pos); else return pos; } },
    next(pos) { for (;;) { if (pos < src.length && isWs(src.charCodeAt(pos))) pos++; else if (startAt.has(pos)) pos = startAt.get(pos); else return pos; } },
  };
}
const CHAIN = new Set([K.PropertyAccessExpression, K.ElementAccessExpression, K.CallExpression, K.TaggedTemplateExpression, K.PostfixUnaryExpression]);
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
    case K.NewExpression: return n.arguments || n.typeArguments ? null : n.expression;
    default: return null;
  }
};
const HEAD = new Set([K.IfStatement, K.WhileStatement, K.DoStatement, K.SwitchStatement, K.WithStatement]);

function run(src, file) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) return { skip: "tsc rejects: TS" + sf.parseDiagnostics[0].code };
  const gaps = makeGaps(src, commentRanges(src, sf));
  const erase = n => { while (isParen(n) || isWrap(n)) n = n.expression; return n; };
  // What parse_prefix returned when the cast was read.
  const prefixOperand = e => {
    for (;;) {
      if (isParen(e)) return erase(e.expression);
      if (e.kind === K.PropertyAccessExpression || e.kind === K.ElementAccessExpression || e.kind === K.CallExpression || e.kind === K.NonNullExpression || isInst(e) || e.kind === K.TypeAssertionExpression) e = e.expression;
      else if (e.kind === K.TaggedTemplateExpression) e = e.tag;
      else if (e.kind === K.PostfixUnaryExpression) e = e.operand;
      else return e;
    }
  };
  const prefixEnd = e => {
    for (;;) {
      if (isParen(e)) return e.end;
      if (e.kind === K.PropertyAccessExpression || e.kind === K.ElementAccessExpression || e.kind === K.CallExpression || e.kind === K.NonNullExpression || isInst(e) || e.kind === K.TypeAssertionExpression) e = e.expression;
      else if (e.kind === K.TaggedTemplateExpression) e = e.tag;
      else if (e.kind === K.PostfixUnaryExpression) e = e.operand;
      else return e.end;
    }
  };

  // Records in the order the parser makes them.
  const all = [];
  let seq = 0;
  (function collect(n) {
    ts.forEachChild(n, collect);
    if (!isWrap(n)) return;
    const s = seq++;
    let rec;
    if (n.kind === K.NonNullExpression) rec = { kind: "NonNull", op: n.end - 1, end: n.end, operand: erase(n.expression), time: n.end, cast: 0 };
    else if (isInst(n)) rec = { kind: "Inst", op: gaps.next(n.expression.end), end: n.end, operand: erase(n.expression), time: n.end, cast: 0 };
    else if (n.kind === K.TypeAssertionExpression) {
      const gt = gaps.next(n.type.end) + 1;
      if (MODE === "D1") rec = { kind: "TypeAssertion", op: n.getStart(sf), gt, operand: prefixOperand(n.expression), time: prefixEnd(n.expression), cast: 1 };
      else rec = { kind: "TypeAssertion", op: n.getStart(sf), gt, operand: erase(n.expression), time: n.end, cast: 0 };
    } else rec = { kind: n.kind === K.AsExpression ? "As" : "Satisfies", op: gaps.next(n.expression.end), end: n.end, operand: erase(n.expression), time: n.end, cast: 0 };
    rec.seq = s;
    all.push(rec);
  })(sf);
  if (MODE === "D1") all.sort((a, b) => a.time - b.time || a.cast - b.cast || (a.cast ? b.op - a.op : a.seq - b.seq));
  const records = new Map();
  for (const r of all) { if (!records.has(r.operand)) records.set(r.operand, []); records.get(r.operand).push(r); }
  let used = 0;

  const rebuilt = [], done = new Map();
  const hug = r => {
    const p = gaps.prevEnd(r.start), q = gaps.next(r.end);
    return p > 0 && src[p - 1] === "(" && src[q] === ")" ? [p - 1, q] : null;
  };
  // Slot rules that need only what Bun's tree holds.
  function slotOf(parent, child, leftRange) {
    if (!parent) return {};
    if ((parent.kind === K.CallExpression || parent.kind === K.NewExpression) && parent.arguments && parent.arguments.includes(child)) return { callOpen: parent.arguments.pos - 1 };
    if (HEAD.has(parent.kind) && parent.expression === child) return { head: true };
    if (parent.kind === K.JsxExpression && (parent.parent.kind === K.JsxElement || parent.parent.kind === K.JsxFragment)) return { jsxChild: true };
    if (parent.kind === K.JsxElement || parent.kind === K.JsxFragment) return { jsxChild: true };
    return {};
  }
  function parens(st, slot) {
    for (;;) {
      const h = hug(st.range);
      if (!h) return;
      if (slot.callOpen !== undefined && h[0] === slot.callOpen) return;
      st.range = { start: h[0], end: h[1] + 1 };
      st.layers.push("ParenthesizedExpression:" + h[0] + ":" + (h[1] + 1));
    }
  }
  function apply(st, w) {
    if (w.kind === "TypeAssertion") {
      if (gaps.prevEnd(st.range.start) !== w.gt) throw new Error("cast <...> ending at " + w.gt + " does not precede " + st.range.start);
      st.range = { start: w.op, end: st.range.end };
    } else {
      if (gaps.next(st.range.end) !== w.op) throw new Error(w.kind + " operator at " + w.op + " does not follow " + st.range.end);
      st.range = { start: st.range.start, end: w.end };
    }
    st.layers.push((w.kind === "Inst" ? "ExpressionWithTypeArguments" : w.kind + "Expression") + ":" + st.range.start + ":" + st.range.end);
    used++;
  }
  function flush(st, slot) {
    for (const w of st.pending) { parens(st, slot); apply(st, w); }
    st.pending = [];
    parens(st, slot);
  }
  // Range of the erased node with the layers that bind as tightly as a member access. Casts of MODE=D1 stay pending.
  function chain(child, parent, slot) {
    const e = erase(child);
    if (done.has(e)) throw new Error("operand met twice");
    const l = leftOperand(e), r = rightOperand(e);
    let st;
    if (l) {
      st = chain(l, e, {});
      // A ) after the chain closes a parenthesis that opened before the innermost pending cast.
      while (st.pending.length && src[gaps.next(st.range.end)] === ")") { apply(st, st.pending.shift()); parens(st, {}); }
      if (!CHAIN.has(e.kind)) flush(st, {});
      if (e.kind === K.CallExpression) {
        let t = gaps.next(st.range.end);
        if (src.startsWith("?.", t)) t = gaps.next(t + 2);
        if (e.typeArguments) t = gaps.next(gaps.next(e.typeArguments.end) + 1);
        if (src[t] !== "(" || t !== e.arguments.pos - 1) throw new Error("the ( of the call at " + (e.arguments.pos - 1) + " is not the token after the callee, found " + t);
      }
      st = { range: { start: st.range.start, end: 0 }, pending: st.pending, layers: st.layers };
    } else st = { range: { start: e.getStart(sf), end: 0 }, pending: [], layers: [] };
    st.range.end = r ? full(r, e).end : e.end;
    ts.forEachChild(e, c => { if (c !== l && c !== r) drive(c, e); });
    const recs = records.get(e) || [];
    let i = 0;
    for (;;) {
      parens(st, slot);
      if (i === recs.length) break;
      const w = recs[i];
      if (w.cast) { st.pending.push(w); i++; continue; }
      const tight = w.kind === "NonNull" || w.kind === "Inst";
      if (w.kind === "TypeAssertion") { apply(st, w); i++; continue; }
      const adjacent = gaps.next(st.range.end) === w.op;
      if (tight && adjacent) { apply(st, w); i++; continue; }
      if (st.pending.length) { apply(st, st.pending.shift()); continue; }
      if (adjacent) { apply(st, w); i++; continue; }
      throw new Error(w.kind + " at " + w.op + " is not adjacent to [" + st.range.start + "," + st.range.end + ")");
    }
    done.set(e, st.range);
    return st;
  }
  function full(child, parent) {
    const slot = slotOf(parent, child);
    const st = chain(child, parent, slot);
    flush(st, slot);
    if (slot.head) {
      const last = st.layers.pop();
      if (!last || !last.startsWith("Paren")) throw new Error("statement head without its own parentheses");
      const [, s, en] = last.split(":").map(Number);
      st.range = { start: gaps.next(s + 1), end: gaps.prevEnd(en - 1) };
    }
    if (slot.jsxChild) {
      // A child of a JSX element stands in an expression container only when { and } are the tokens around it.
      const p = gaps.prevEnd(st.range.start), q = gaps.next(st.range.end);
      const open = src[p - 1] === "{" || (src.slice(p - 3, p) === "..." && src[gaps.prevEnd(p - 3) - 1] === "{");
      if (!(open && src[q] === "}")) {
        const e = erase(child);
        if (e.kind !== K.JsxElement && e.kind !== K.JsxSelfClosingElement && e.kind !== K.JsxFragment) throw new Error("JSX child that is not an element stands outside a container");
        if (st.layers.some(x => !x.startsWith("Paren"))) throw new Error("record on a JSX child between text");
        st.layers.length = 0;
        st.range = { start: e.getStart(sf), end: e.end };
        done.set(e, st.range);
      }
    }
    for (const x of st.layers) rebuilt.push(x);
    return st.range;
  }
  const isName = (parent, c) => parent.name === c || parent.propertyName === c || parent.label === c || parent.tagName === c || ts.isBindingPattern(c);
  function drive(n, parent) {
    if (parent && isName(parent, n)) { ts.forEachChild(n, c => drive(c, n)); return; }
    if (n.kind === K.ExpressionWithTypeArguments && !isInst(n)) { drive(n.expression, n); ts.forEachChild(n, c => { if (c !== n.expression) drive(c, n); }); return; }
    if (isInst(n)) { if (!done.has(erase(n))) full(n, parent); return; }
    if (ts.isTypeNode(n)) { ts.forEachChild(n, c => drive(c, n)); return; }
    if (ts.isExpression(n) && !(ts.isToken(n) && !ts.isIdentifier(n) && n.kind < K.FirstKeyword) && !(parent && ts.isTypeNode(parent) && ts.isIdentifier(n)) && n.kind !== K.OmittedExpression && n.kind !== K.JsxExpression
        && !(parent && (parent.kind === K.QualifiedName || parent.kind === K.TypeParameter || parent.kind === K.JsxAttribute && parent.name === n || parent.kind === K.JsxNamespacedName))) {
      if (parent && parent.kind === K.ExternalModuleReference) return;
      if (!done.has(erase(n))) full(n, parent);
      return;
    }
    ts.forEachChild(n, c => drive(c, n));
  }
  drive(sf, null);

  const expected = [];
  (function walk(n) {
    if (isParen(n) || isWrap(n)) expected.push((isInst(n) ? "ExpressionWithTypeArguments" : K[n.kind]) + ":" + n.getStart(sf) + ":" + n.end);
    ts.forEachChild(n, walk);
  })(sf);
  expected.sort(); rebuilt.sort();
  return { ok: JSON.stringify(expected) === JSON.stringify(rebuilt) && used === all.length, expected, rebuilt, unused: all.length - used };
}

module.exports = { run };
if (require.main === module) {
  const args = process.argv.slice(2);
  let pass = 0, fail = 0, skipped = 0, layers = 0;
  const fails = [];
  const one = (src, file, label) => {
    let r;
    try { r = run(src, file); } catch (e) { r = { ok: false, error: String(e.message) }; }
    if (r.skip) { skipped++; if (!dir) console.log("SKIP " + label + "  " + r.skip); return; }
    if (r.ok) { pass++; layers += r.rebuilt.length; if (!dir) console.log("PASS " + label + "  " + r.rebuilt.join(" ")); return; }
    fail++;
    if (fails.length < 40) fails.push([label, r]);
  };
  const dir = args[0] === "--dir";
  if (dir) {
    const walk = d => {
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(f); continue; }
        if (!(process.env.JS ? /\.(js|jsx|mjs|cjs)$/ : /\.(ts|tsx|mts|cts)$/).test(e.name)) continue;
        let src; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (src.length > 400000) continue;
        one(src, "t" + path.extname(e.name), f);
      }
    };
    for (const d of args.slice(1)) walk(d);
  } else {
    for (const f of args) for (const item of JSON.parse(fs.readFileSync(f, "utf8"))) {
      const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
      one(src, file, JSON.stringify(src));
    }
  }
  console.log(`\nMODE=${MODE} pass ${pass} fail ${fail} skipped ${skipped} layers ${layers}`);
  for (const [label, r] of fails) {
    const exp = new Set(r.expected || []), got = new Set(r.rebuilt || []);
    console.log("FAIL " + label + (r.error ? "\n   error " + r.error : "") + "\n   missing " + [...exp].filter(x => !got.has(x)).slice(0, 5).join(" ") + "\n   extra   " + [...got].filter(x => !exp.has(x)).slice(0, 5).join(" ") + (r.unused ? "\n   unused records " + r.unused : ""));
  }
  process.exitCode = fail ? 1 : 0;
}
