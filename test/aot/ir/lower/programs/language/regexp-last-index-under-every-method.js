// RUN: lower
// OPTIONS: builtin-modules

// Regexp last index under every method.
const out = [];
const fmt = v => v === undefined ? "undefined" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "object" && v !== null && !Array.isArray(v) ? (v.tag ?? JSON.stringify(v)) : JSON.stringify(v) ?? String(v);
let log = [];
const makers = { plain: () => /a(b)?/, g: () => /a(b)?/g, y: () => /a(b)?/y, gy: () => /a(b)?/gy, u: () => /a(b)?/u, gu: () => /(?:)/gu, empty: () => /(?:)/g, emptyY: () => /(?:)/y, i: () => /A/gi, m: () => /^a/gm, s: () => /a.b/gs, d: () => /a(b)?/gd, named: () => /(?<x>a)(?<y>b)?/g, v: () => /[a]/gv, made: () => new RegExp("a(b)?", "g"), madeY: () => new RegExp("a", "y"), sub: () => new (class R extends RegExp {})("a(b)?", "g") };
const indices = { zero: () => 0, one: () => 1, two: () => 2, big: () => 100, len: () => 6, minus: () => -1, minusZero: () => -0, frac: () => 1.7, nan: () => NaN, inf: () => Infinity, two32: () => 2 ** 32, two32p1: () => 2 ** 32 + 1, two53: () => 2 ** 53, text: () => "1", textBad: () => "x", nul: () => null, undef: () => undefined, tru: () => true, obj: () => ({ tag: "obj", valueOf() { log.push("valueOf"); return 1; } }), objThrows: () => ({ tag: "objThrows", valueOf() { log.push("valueOf"); throw new RangeError("my v"); } }), sym: () => Symbol.iterator, bigint: () => 1n };
const states = { open: r => r, frozen: r => Object.freeze(r), sealed: r => Object.seal(r), fixed: r => Object.defineProperty(r, "lastIndex", { writable: false }), inextensible: r => Object.preventExtensions(r) };
const uses = { test: (r, s) => r.test(s), exec: (r, s) => { const m = r.exec(s); return m && [m.index, ...m]; }, execIndex: (r, s) => r.exec(s)?.index, match: (r, s) => s.match(r), matchAll: (r, s) => [...s.matchAll(r)].map(m => m.index), replace: (r, s) => s.replace(r, "<$&>"), replaceFn: (r, s) => s.replace(r, m => "[" + m + "]"), replaceAll: (r, s) => s.replaceAll(r, "_"), search: (r, s) => s.search(r), split: (r, s) => s.split(r), splitLimit: (r, s) => s.split(r, 2), testTwice: (r, s) => [r.test(s), r.lastIndex, r.test(s)], loop: (r, s) => { const a = []; let m, n = 0; while ((m = r.exec(s)) && n++ < 5) a.push(m.index); return a; }, ifTest: (r, s) => (r.test(s) ? "yes" : "no"), destructure: (r, s) => { const [all, g1] = r.exec(s) ?? []; return [all, g1]; }, symbolMatch: (r, s) => r[Symbol.match](s), symbolReplace: (r, s) => r[Symbol.replace](s, "#"), symbolSearch: (r, s) => r[Symbol.search](s), symbolSplit: (r, s) => r[Symbol.split](s) };
for (const [mn, make] of Object.entries(makers)) for (const [un, use] of Object.entries(uses)) {
  for (let i = 0; i < 12; i++) { try { use(make(), "xabaab"); } catch {} }
  for (const [sn, state] of Object.entries(states)) for (const [xn, index] of Object.entries(indices)) {
    if (sn !== "open" && !["zero", "one", "big", "obj"].includes(xn)) continue;
    for (const subject of ["xabaab", "zzz", ""]) {
      log = []; let r, answer;
      try { r = make(); r.lastIndex = index(); state(r); answer = fmt(use(r, subject)); } catch (e) { answer = "throws " + e.constructor.name; }
      let after; try { after = fmt(r.lastIndex); } catch { after = "?"; }
      out.push([mn, un, sn, xn, JSON.stringify(subject), "=>", answer, "lastIndex", typeof r.lastIndex === "symbol" ? "symbol" : typeof r.lastIndex === "bigint" ? "1n" : after, log.join()].join(" "));
    }
  }
}
const shared = /a/g; function useShared(s) { return [shared.test(s), shared.lastIndex]; }
for (let i = 0; i < 8; i++) out.push("shared " + JSON.stringify(useShared("aaa")));
function literalInLoop() { const seen = []; for (let i = 0; i < 3; i++) { const r = /a/g; seen.push(r.lastIndex, r.test("aa"), r.lastIndex); } return seen; }
out.push("fresh each turn " + JSON.stringify(literalInLoop()));
function identity() { const f = () => /a/g; return f() === f(); } out.push("literals are distinct " + identity());
out.push("statics " + JSON.stringify([/(b)(c)?/.test("abc"), RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.input, RegExp["$&"], RegExp.lastParen]));
out.push("statics after a failure " + JSON.stringify([/zzz/.test("abc"), RegExp.$1, RegExp.lastMatch])); out.push("statics after replace " + JSON.stringify(["xyz".replace(/(y)/, "-"), RegExp.$1, RegExp.leftContext])); out.push("statics after split " + JSON.stringify(["p,q".split(/(,)/), RegExp.$1, RegExp.lastMatch])); out.push("statics after match g " + JSON.stringify(["a1b2".match(/\d/g), RegExp.lastMatch, RegExp.leftContext])); out.push("statics after search " + JSON.stringify(["hello".search(/l+/), RegExp.lastMatch])); out.push("statics after matchAll " + JSON.stringify([[..."k1k2".matchAll(/k(\d)/g)].length, RegExp.$1])); out.push("statics after replaceAll text " + JSON.stringify(["k1k2".replaceAll("k", "j"), RegExp.$1])); out.push("statics after includes " + JSON.stringify(["k1k2".includes("k"), RegExp.lastMatch]));
console.log(out.join("\n"));

// GENERATED: m d bigint destructure symbolSearch R
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|RegExp flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="^a" regExpFlags=[Global, Multiline]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|RegExp flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="d"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|RegExp flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="a(b)?" regExpFlags=[HasIndices, Global]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|RegExp flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bigint"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|bigint flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = BigInt digits="1"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|bigint flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="destructure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}, {type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="exec"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v0, v1 calleeKey="exec" calleeName="r.exec"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined|null
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Data data=[[d_6]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = IteratorOpen v11 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v13 = IteratorResume v12 stepIndex=0
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v16 = IteratorResume v12 stepIndex=1
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: IteratorClose v12
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v20 = NewArray v15, v18 contents=anything
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: b11() role=IterationCleanup subject=v12:
// CHECK-NEXT: v22 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="symbolSearch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key=@@search
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v0, v1 calleeKey=@@search
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="R"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
