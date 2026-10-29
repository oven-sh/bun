// RUN: lower
// OPTIONS: builtin-modules

// Environments: captured variables shared, mutated after capture, per-iteration bindings, TDZ, recursion, re-entrancy.
function counter() { let n = 0; return { inc() { return ++n; }, get() { return n; }, reset() { n = "zero"; } }; }
const c1 = counter(), c2 = counter(); c1.inc(); c1.inc(); c2.inc(); console.log(c1.get(), c2.get()); c1.reset(); console.log(c1.inc(), c1.get(), c2.get());
const fs = []; for (let i = 0; i < 3; i++) { fs.push(() => i); i += 0; } console.log(fs.map(f => f()).join());
const gs = []; for (let i = 0; i < 3; i++) { gs.push(() => i++); } console.log(gs.map(f => f()).join(), gs.map(f => f()).join());
var hs = []; for (var v = 0; v < 3; v++) hs.push(() => v); console.log(hs.map(f => f()).join());
function tdz() { try { const f = () => x; f(); let x = 1; return x; } catch (e) { return e.name; } } console.log(tdz());
function tdz2(flag) { const read = () => y; if (flag) { try { return read(); } catch (e) { return e.name; } } let y = 5; return read(); } console.log(tdz2(true), tdz2(false));
function rec(n, acc) { let mine = n; acc.push(() => mine); if (n) rec(n - 1, acc); mine += 10; return acc; } console.log(rec(3, []).map(f => f()).join());
let top = 1; function bump() { top++; } function readTwice() { const a = top; bump(); return a + top; } console.log(readTwice(), top);
let modVar = 0; const setLater = v => { modVar = v; }; setTimeout(() => { setLater("late"); console.log("timer", modVar, typeof modVar); }, 0); console.log(modVar + 1);
function shared() { let s = 0; const add = k => { s += k; }; [1, 2, 3].forEach(add); return s; } console.log(shared());
function param(a) { const set = () => { a = "set"; }; const before = a; set(); return before + a; } console.log(param(1));
function args(a) { const g = () => arguments[0]; a = 2; return g(); } console.log(args(1));
function* g2() { let k = 0; const f = () => k; while (k < 3) { k++; yield f; } } console.log([...g2()].map(f => f()).join());
async function a2() { let k = 0; const f = () => k; k++; await 0; k++; return f(); } a2().then(v => console.log("async", v));
function sw(x) { switch (x) { case 1: let q = "one"; return () => q; default: try { return q; } catch (e) { return () => e.name; } } } console.log(sw(1)(), sw(2)());
function catchVar() { const out = []; for (const t of [1, 2]) { try { throw t; } catch (e) { out.push(() => e); } } return out.map(f => f()).join(); } console.log(catchVar());
function named() { const f = function self(n) { return n ? self(n - 1) + 1 : 0; }; return f(3); } console.log(named());
function defaults(a, b = () => a) { var a = 5; return [a, b()].join(); } console.log(defaults(1));
function blockFn() { const r = []; for (let i = 0; i < 2; i++) { function inner() { return i; } r.push(inner); } return r.map(f => f()).join(); } console.log(blockFn());
let reent = 0; function re(n) { const my = ++reent; if (n) re(n - 1); return my === reent ? "same" : "differs:" + my + ":" + reent; } console.log(re(2));
const obj = { v: 1, m() { return () => this.v; } }; const arrow = obj.m(); obj.v = 2; console.log(arrow(), obj.m.call({ v: 9 })());

// GENERATED: args g2 a2 get
// CHECK-LABEL: function {{*}}name="args"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = NewClosure v3 function=[[f_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Call v5 calleeName="g"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[f_3]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject layout=[[L_4]]
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v2, v5 layout=[[L_4]]
// CHECK-NEXT: v7 = NewClosure v2 function=[[f_5]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = GetEnvironmentField v2 layout=[[L_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="k"
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Less v11, v12
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b7()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = GetEnvironmentField v2 layout=[[L_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="k"
// CHECK-NEXT: v16 = Increment v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v18 = GetEnvironmentField v2 layout=[[L_4]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="k"
// CHECK-NEXT: PutEnvironmentField v2, v17 layout=[[L_4]]
// CHECK-NEXT: v21 = Yield v8
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: Switch v23 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v22
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_6]]
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_6]]
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_7]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v7 = GetEnvironmentField v1 layout=[[L_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="k"
// CHECK-NEXT: v9 = Increment v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = GetEnvironmentField v1 layout=[[L_6]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="k"
// CHECK-NEXT: PutEnvironmentField v1, v10 layout=[[L_6]]
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Await v14
// CHECK-NEXT: v16 = GetEnvironmentField v1 layout=[[L_6]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="k"
// CHECK-NEXT: v18 = Increment v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = GetEnvironmentField v1 layout=[[L_6]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="k"
// CHECK-NEXT: PutEnvironmentField v1, v19 layout=[[L_6]]
// CHECK-NEXT: v23 = Call v6 calleeName="f"
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v25 = Convert v24 declared={type=number|object flags=[IsExpected]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
