// RUN: lower
// OPTIONS: builtin-modules

// Eleven ways to see an object before its constructor has stored every field.
const log = (...a) => console.log(a.map(x => typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)).join(" "));
// 1: the class above calls a method that the class below overrides, before the fields below exist
class A1 { constructor() { this.a = 1; this.seen = this.look(); } look() { return "A"; } }
class B1 extends A1 { y = 7; z = "s"; look() { return [this.y, this.z, "y" in this, Object.keys(this).join()].join("|"); } }
log(1, new B1().seen, new B1().y);
// 2: the class above hands `this` out, then the initializer below throws
const kept2 = [];
class A2 { constructor() { this.a = 1; kept2.push(this); } }
let fail2 = true;
class B2 extends A2 { y = (() => { if (fail2) throw new Error("no"); return 5; })(); w = 2.5; sum() { return this.y + this.w; } }
try { new B2(); } catch (e) { log(2, e.message); }
fail2 = false; new B2();
for (const o of kept2) log(2, o.y, o.w, o.sum(), Object.keys(o).join(), o.hasOwnProperty("w"));
// 3: Reflect.construct with another function in place of the constructor
class C3 { constructor() { this.p = 1; this.q = "two"; } get both() { return this.p + this.q; } }
function Other3() { this.r = 3; }
const o3 = Reflect.construct(Other3, [], C3);
log(3, o3 instanceof C3, o3.p, o3.q, o3.both, o3.r, Object.keys(o3).join());
const o3b = Reflect.construct(Object, [], C3);
log(3, o3b instanceof C3, o3b.p, o3b.both, Object.keys(o3b).join());
// 4: Object.create of the prototype
class C4 { constructor() { this.p = 1.5; this.q = { n: 1 }; } m() { return this.p * 2 + (this.q ? this.q.n : -1); } }
const all4 = [new C4(), Object.create(C4.prototype), new C4()];
for (const o of all4) log(4, o.m(), o.p, o.q);
// 5: the constructor above returns another object
const foreign5 = { f: 1 };
class A5 { constructor(x) { if (x) return foreign5; this.a = 1; } }
class B5 extends A5 { y = 9; m() { return this.y; } }
const o5 = new B5(true), p5 = new B5(false);
log(5, o5 === foreign5, o5.y, foreign5, o5 instanceof B5, p5.m(), p5);
// 6: the object leaks through a setter that it inherits
let got6 = null;
class A6 { set tap(v) { got6 = this; } }
class B6 extends A6 { constructor() { super(); this.tap = 1; this.late = 4; this.later = "x"; } }
const probe6 = () => got6 ? [got6.late, got6.later, Object.keys(got6).length].join() : "none";
class D6 extends A6 { constructor() { super(); this.tap = 1; log(6, probe6()); this.late = 4; this.later = "x"; } }
new B6(); log(6, probe6()); new D6(); log(6, probe6());
// 7: a throw in the middle of a constructor, the object kept by a closure
let peek7;
class C7 { constructor(n) { this.a = n; peek7 = () => [this.a, this.b, this.c, "c" in this].join(); if (n > 1) throw new Error("mid"); this.b = n * 2; this.c = "c"; } }
new C7(1); log(7, peek7()); try { new C7(2); } catch {} log(7, peek7());
// 8: a stack overflow in the middle of a constructor
const kept8 = [];
function deep8(n) { return n === 0 ? 0 : 1 + deep8(n - 1); }
class C8 { constructor(n) { this.a = 1; kept8.push(this); this.b = deep8(n); this.c = 3; } t() { return this.a + this.b + this.c; } }
new C8(3); try { new C8(1e7); } catch (e) { log(8, e instanceof RangeError); }
for (const o of kept8) log(8, o.t(), o.b, o.c, Object.keys(o).join());
// 9: constructor function called without new, on another object
function F9(v) { this.v = v; this.w = v + 1; }
F9.prototype.s = function () { return this.v + this.w; };
const bare9 = Object.create(F9.prototype); log(9, bare9.s(), bare9.v);
F9.call(bare9, 4); log(9, bare9.s()); const plain9 = {}; F9.call(plain9, 5); log(9, plain9);
// 10: field initializers that read fields below them
class C10 { a = this.b; b = 2; c = this.a; d = Object.keys(this).join(); }
log(10, new C10());
// 11: a getter of the class above reads a field of the class below through super's constructor and toString
class A11 { constructor() { this.text = `${this}`; } }
class B11 extends A11 { n = 5; toString() { return "n=" + this.n; } }
log(11, new B11().text, String(new B11()));

// GENERATED: tap B1 B6
// CHECK-LABEL: function {{*}}name="tap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="got6"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]]|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_2]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B6"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b16(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v14 key="tap"
// CHECK-NEXT: v16 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v17) frequency=Unlikely:
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Integer integer=4
// CHECK-NEXT: v22 = Convert v21 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v20, v22 key="late"
// CHECK-NEXT: v24 = TypeTest v19 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b8(v27):
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v29 = String string="x"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v28, v30 key="later"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: v33 = TypeTest v32 testedType=object
// CHECK-NEXT: Branch v33 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v34):
// CHECK-NEXT: Jump -> next b14(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = TypeTest v35 testedType=undefined
// CHECK-NEXT: Branch v36 -> taken b11(| 0), notTaken b15(| 0)
// CHECK-NEXT: b11(v37):
// CHECK-NEXT: v38 = TypeTest v27 testedType=absent
// CHECK-NEXT: Branch v38 -> taken b12(| 0), notTaken b13(| 0)
// CHECK-NEXT: b12(v39) frequency=Unlikely:
// CHECK-NEXT: v40 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v40
// CHECK-NEXT: b13(v41):
// CHECK-NEXT: Jump -> next b14(v41)
// CHECK-NEXT: b14(v42):
// CHECK-NEXT: Return v42
// CHECK-NEXT: b15(v43) frequency=Unlikely:
// CHECK-NEXT: v44 = NewRuntimeError runtimeError=DerivedConstructorResult name="B6"
// CHECK-NEXT: Throw v44
// CHECK-NEXT: b16(v45) frequency=Unlikely:
// CHECK-NEXT: v46 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v46
// CHECK-NEXT: }
