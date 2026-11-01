// RUN: lower
// OPTIONS: builtin-modules

// What a call passes beyond the named parameters lies in the array of the rest parameter, and whoever keeps that array or an element of it keeps the value.
const out = [];
function churn() { const junk = []; for (let i = 0; i < 200000; i++) junk.push({ a: i, b: [i] }); return junk.length; }

let kept1; function take1(...rest) { kept1 = rest[0]; }
function make1(i) { const o = { x: i, y: [i, i + 1] }; take1(o); }
for (let i = 0; i < 5; i++) make1(i);
churn(); out.push("element: " + kept1.x + " " + kept1.y.join());

let kept2; function take2(a, ...rest) { kept2 = rest; }
function make2(i) { const o = { x: i }; const p = { z: "p" + i }; take2(0, o, p); }
for (let i = 0; i < 5; i++) make2(i);
churn(); out.push("array: " + kept2.length + " " + kept2[0].x + " " + kept2[1].z);

let kept3; function take3(...rest) { kept3 = rest[1]; }
function make3(i) { let n = i; take3(0, () => n++); }
for (let i = 0; i < 5; i++) make3(i * 10);
churn(); out.push("closure: " + kept3() + " " + kept3());

let kept4; function take4(...rest) { kept4 = rest[0]; }
function make4(i) { const a = [i, i * 2, i * 3]; take4(a); a.push(7); }
for (let i = 0; i < 5; i++) make4(i);
churn(); out.push("an array: " + kept4.join());

let kept5; class Taker { take(...rest) { kept5 = rest[0]; } }
function make5(t, i) { const o = { x: i }; t.take(o); o.x += 100; }
const taker = new Taker(); for (let i = 0; i < 5; i++) make5(taker, i);
churn(); out.push("method: " + kept5.x);

let kept6; function take6(...rest) { kept6 = rest[0]; } function read6() { return "w" in kept6 ? kept6.w : "missing"; }
function Made6() { take6(this); this.early = read6(); this.w = 5; }
out.push("constructor function: " + new Made6().early + " " + read6());

let kept7; function take7(a, ...rest) { kept7 = rest[0]; } function read7() { const t = kept7.x; return t === undefined ? "missing" : t + 1; }
class C7 { constructor() { take7(1, this); this.early = read7(); this.x = 1; } }
out.push("behind a named parameter: " + new C7().early + " " + read7());

let kept8; function read8() { const t = kept8.x; return t === undefined ? "missing" : t + 1; }
class C8 { constructor() { [0].forEach(function (...rest) { kept8 = this; }, this); this.early = read8(); this.x = 1; } }
out.push("this of a callback with a rest parameter: " + new C8().early + " " + read8());

let kept9; function read9() { const t = kept9.x; return t === undefined ? "missing" : t + 1; }
class C9 { constructor() { [this].forEach((...rest) => { kept9 = rest[0]; }); this.early = read9(); this.x = 1; } }
out.push("an element handed to a callback with a rest parameter: " + new C9().early + " " + read9());

console.log(out.join("\n"));

// GENERATED: read6 take7 churn Taker
// CHECK-LABEL: function {{*}}name="read6"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="kept6"
// CHECK-NEXT: v2 = PropHas v1 key="w"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="kept6"
// CHECK-NEXT: v7 = PropGet v6 key="w"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = String string="missing"
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take7"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="kept7"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = ElemGet v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_2]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_4]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Integer integer=200000
// CHECK-NEXT: v8 = Less v5, v7
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = PropGet v2 key="push"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v13, v12 key="a"
// CHECK-NEXT: v15 = NewArray v9 contents=number
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: PropDefine v13, v16 key="b"
// CHECK-NEXT: v18 = FinishObject v13
// CHECK-NEXT: v19 = Call v11, v2, v18 calleeKey="push" calleeName="junk.push"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Increment v9
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v23 = PropGet v2 key="length"
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Taker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
