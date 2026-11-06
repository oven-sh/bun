// RUN: lower
// OPTIONS: builtin-modules

// Array patterns with holes (`[, x]`) over every kind of iterable in every position a pattern can have, and iterables whose elements throw.
function row(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": threw " + (e && e.name ? e.name + " " + e.message : String(e))); } }
const S = v => JSON.stringify(v);
// ---- a98: elisions
const ITER = {
  "a string": () => "wxyz", "a string of pairs": () => "\u{1F600}b\u{1F601}d", "an empty string": () => "", "a rope": () => "wx".repeat(1) + "yz".slice(0), "a String object": () => new String("wxyz"),
  "an array": () => [1, 2, 3, 4], "an array with a hole": () => [1, , 3, 4], "doubles": () => [1.5, 2.5, 3.5, 4.5], "a short array": () => [1],
  "a Map": () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]), "a Set": () => new Set([5, 6, 7, 8]), "a typed array": () => new Uint8Array([1, 2, 3, 4]),
  "a generator": () => (function* () { yield 1; yield 2; yield 3; yield 4; })(), "entries": () => [7, 8, 9, 10].entries(), "arguments": () => (function () { return arguments; })(1, 2, 3, 4),
};
for (const k in ITER) {
  row(k + ", by a table", () => { const [, b] = ITER[k](); const [, , c] = ITER[k](); const [a, , d] = ITER[k](); const [, ...r] = ITER[k](); const [, , , , e] = ITER[k](); return S([b, c, a, d, r, e]); });
}
row("a string, written: binding", () => { const [, b] = "xy"; const [, , c] = "xyz"; const [a, , d] = "xyz"; const [, ...r] = "xyz"; return S([b, c, a, d, r]); });
row("a string, written: a parameter", () => S([(([, b]) => b)("xy"), (([, , c]) => c)("xyz"), (([a, , c]) => a + c)("xyz"), (([, ...r]) => r)("xyz")]));
row("a string, written: assignment", () => { let a, b, c, r; [, b] = "xy"; [, , c] = "xyz"; [a, , c] = "pqr"; [, ...r] = "xyz"; return S([b, c, a, r]); });
row("a string, written: a for of head", () => { let s = ""; for (const [, b] of ["xy", "pq"]) s += b; for (const [, , c] of ["xyz"]) s += c; return s; });
row("a string, written: a catch", () => { try { throw "xy"; } catch ([, b]) { return b; } });
row("a string, written: nested", () => { const [[, b], [, , c]] = ["xy", "pqr"]; const { k: [, d] } = { k: "mn" }; return b + c + d; });
row("a string, written: with defaults", () => { const [, b = "dflt"] = "x"; const [, c = "dflt"] = "xy"; const [, , d = "dflt"] = "xy"; return b + c + d; });
row("pairs of units, written", () => { const [, b] = "\u{1F600}b"; const [, , c] = "a\u{1F600}c"; const [, p] = "a\u{1F600}"; return S([b, c, p, p.length]); });
row("only elisions", () => { const [,] = "xy"; const [, ,] = "x"; const [, , ,] = ""; let n = 0; const it = { [Symbol.iterator]() { return { next() { n++; return { done: false, value: n }; }, return() { n += 100; return {}; } }; } }; const [, ,] = it; return n; });
row("what a hand-made iterator sees", () => { const log = []; const it = { [Symbol.iterator]() { let i = 0; return { next() { log.push("next"); return { get done() { log.push("done"); return i >= 3; }, get value() { log.push("value"); return i++; } }; }, return() { log.push("return"); return {}; } }; } }; const [, b] = it; log.push("|"); const [a, , c] = it; log.push("|"); const [, , , , e] = it; return log.join(",") + " " + S([b, a, c, e]); });
row("a getter on the element passed over", () => { const log = []; const a = [1, 2, 3]; Object.defineProperty(a, 0, { get() { log.push("get 0"); return 1; } }); Object.defineProperty(a, 1, { get() { log.push("get 1"); return 2; } }); const [, b] = a; log.push("|"); const [, , c] = a; log.push("|"); let d; [, , d] = a; return log.join(",") + " " + S([b, c, d]); });
row("a getter on the element passed over that throws", () => { const a = [1, 2, 3]; Object.defineProperty(a, 0, { get() { throw new RangeError("passed over"); } }); try { const [, b] = a; return "no throw " + b; } catch (e) { return "caught " + e.message; } });
row("a generator: how far it ran", () => { const log = []; function* g() { log.push("a"); yield 1; log.push("b"); yield 2; log.push("c"); yield 3; log.push("d"); } const [, b] = g(); log.push("|"); const [, ,] = g(); log.push("|"); const [, , , ,] = g(); return log.join("") + b; });
row("hot", () => { let s = 0; const f = ([, b]) => b.charCodeAt(0); for (let i = 0; i < 300; i++) s += f("xy") + f("pq"); return s; });
// ---- a97: the element read may throw
const boom = (a, at) => Object.defineProperty(a, at, { get() { throw "boom" + at; }, configurable: true });
row("for of in a try", () => { function f(a) { try { for (const x of a) boom(a, 1); } catch (e) { return "caught " + e; } return "none"; } try { return f([1, 2]); } catch (e) { return "THE CALLER caught " + e; } });
row("the first element", () => { function f(a) { try { for (const x of a) return "ran"; } catch (e) { return "caught " + e; } return "none"; } try { return f(boom([1, 2], 0)); } catch (e) { return "THE CALLER caught " + e; } });
row("an assignment head", () => { function f(a) { let x; try { for (x of a); } catch (e) { return "caught " + e + " x " + x; } return "none"; } try { return f(boom([1, 2, 3], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("a pattern head", () => { function f(a) { try { for (const [x] of a); } catch (e) { return "caught " + e; } return "none"; } try { return f(boom([[1], [2]], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("a member head", () => { function f(a) { const o = {}; try { for (o.x of a); } catch (e) { return "caught " + e + " " + o.x; } return "none"; } try { return f(boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("finally runs, then the outer catch", () => { const log = []; function f(a) { try { try { for (const x of a) log.push(x); } finally { log.push("finally"); } } catch (e) { log.push("caught " + e); } return log.join(); } try { return f(boom([1, 2, 3], 2)); } catch (e) { return "THE CALLER caught " + e + " " + log.join(); } });
row("the try stands in the loop's body only", () => { function f(a) { for (const x of a) { try { boom(a, 1); } catch (e) { return "the body's try caught " + e; } } return "none"; } try { return f([1, 2]); } catch (e) { return "the caller caught " + e; } });
row("two loops, the inner one throws", () => { function f(a, b) { try { for (const x of a) { try { for (const y of b); } catch (e) { return "inner caught " + e; } } } catch (e) { return "outer caught " + e; } return "none"; } try { return f([1], boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("in a generator", () => { function* g(a) { try { for (const x of a) yield x; } catch (e) { yield "caught " + e; } } try { return [...g(boom([1, 2, 3], 1))].join(); } catch (e) { return "THE CALLER caught " + e; } });
row("in an arrow", () => { const f = a => { try { for (const x of a); } catch (e) { return "caught " + e; } return "none"; }; try { return f(boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("in a method", () => { class K { f(a) { try { for (const x of a); } catch (e) { return "caught " + e; } return "none"; } } try { return new K().f(boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("the iterator is not closed by what a step throws", () => { const log = []; const it = { [Symbol.iterator]() { return { next() { log.push("next"); throw "from next"; }, return() { log.push("return"); return {}; } }; } }; try { for (const x of it); } catch (e) { log.push("caught " + e); } return log.join(); });
row("a value getter of a hand-made iterator throws", () => { const log = []; const it = { [Symbol.iterator]() { return { next() { return { done: false, get value() { throw "from value"; } }; }, return() { log.push("return"); return {}; } }; } }; function f() { try { for (const x of it); } catch (e) { return "caught " + e; } } try { return f() + " " + log.join(); } catch (e) { return "THE CALLER caught " + e; } });
row("a spread in a try", () => { function f(a) { try { return [...a].length; } catch (e) { return "caught " + e; } } try { return f(boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("a pattern in a try", () => { function f(a) { try { const [x, y] = a; return x + y; } catch (e) { return "caught " + e; } } try { return f(boom([1, 2], 1)); } catch (e) { return "THE CALLER caught " + e; } });
row("an elision in a try", () => { function f(a) { try { const [, y] = a; return "y " + y; } catch (e) { return "caught " + e; } } try { return f(boom([1, 2], 0)); } catch (e) { return "THE CALLER caught " + e; } });
row("hot, then it throws", () => { function f(a) { let s = 0; try { for (const x of a) s += x; } catch (e) { return "caught " + e + " at " + s; } return s; } let t = 0; for (let i = 0; i < 300; i++) t += f([1, 2, 3]); try { return t + " " + f(boom([1, 2, 3], 2)); } catch (e) { return "THE CALLER caught " + e; } });
(async () => { async function f(a) { try { for (const x of a) await 0; } catch (e) { return "caught " + e; } return "none"; } try { console.log("in an async function: " + await f(boom([1, 2], 1))); } catch (e) { console.log("in an async function: THE CALLER caught " + e); }
  async function h(a) { try { for await (const x of a); } catch (e) { return "caught " + e; } return "none"; } try { console.log("for await over an array: " + await h(boom([1, 2], 1))); } catch (e) { console.log("for await over an array: THE CALLER caught " + e); } })();

// GENERATED: entries boom K h done
// CHECK-LABEL: function {{*}}name="entries"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_1]]|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="entries"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="entries" calleeName="entries"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_1]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="boom"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v6, v5 key="get"
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v6, v9 key="configurable"
// CHECK-NEXT: v11 = FinishObject v6
// CHECK-NEXT: v12 = Call v3, v2, v0, v1, v11 calleeName="Object.defineProperty"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v2 = IteratorOpen v1 iteratorKind=Async
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b10():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2, -, v1 iteratorKind=Async
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v7 = String string="none"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string|object flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b9() role=IterationCleanup subject=v2 handler=b10():
// CHECK-NEXT: v9 = CatchException
// CHECK-NEXT: IteratorClose v2, v1 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v9
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = String string="caught "
// CHECK-NEXT: v13 = Add v12, v11
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string|object flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="done"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}, {type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_10]], v1: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="done"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="i"
// CHECK-NEXT: v8 = Integer integer=3
// CHECK-NEXT: v9 = GreaterEq v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
