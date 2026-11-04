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
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = CallDirect v3 function=[[f_1]]
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v2, v5 layout=[[L_2]]
// CHECK-NEXT: v7 = NewClosure v2 function=[[f_3]]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = GetEnvironmentField v2 layout=[[L_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="k"
// CHECK-NEXT: v11 = Integer integer=3
// CHECK-NEXT: v12 = Less v10, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = GetEnvironmentField v2 layout=[[L_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="k"
// CHECK-NEXT: v15 = Increment v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = GetEnvironmentField v2 layout=[[L_2]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="k"
// CHECK-NEXT: PutEnvironmentField v2, v16 layout=[[L_2]]
// CHECK-NEXT: v20 = Yield v7
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Switch v22 cases=[1, 2] -> case b3(), case b4(), otherwise b5()
// CHECK-NEXT: b3():
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b4():
// CHECK-NEXT: Return v21
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b6():
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewObject layout=[[L_4]]
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_4]]
// CHECK-NEXT: v5 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="k"
// CHECK-NEXT: v7 = Increment v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="k"
// CHECK-NEXT: PutEnvironmentField v1, v8 layout=[[L_4]]
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Await v12
// CHECK-NEXT: v14 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="k"
// CHECK-NEXT: v16 = Increment v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v18 = GetEnvironmentField v1 layout=[[L_4]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="k"
// CHECK-NEXT: PutEnvironmentField v1, v17 layout=[[L_4]]
// CHECK-NEXT: v21 = CallDirect v1 function=[[f_5]]
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_6]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
