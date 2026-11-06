// RUN: lower
// OPTIONS: builtin-modules

// A constructor function that many kinds of objects call on themselves creates the same fields in each. Every object lists its
// names in the order in which they were created, whichever kind came to the constructor before it.
function Base(options) {
  if (this.first === undefined) this.first = options;
  this.second ??= 2;
  if (options & 1) this.odd = true;
  this.third = options ? 3 : 4;
  if (options % 3 === 0) { this.fourth = 4; this.fifth = 5; this.sixth = 6; }
}
Base.prototype.sum = function () { return this.second + this.third; };
const kinds = [];
const failures = [];
function kind(body) { Object.setPrototypeOf(body.prototype, Base.prototype); kinds.push(body); }
kind(function A(o) { this.a = 1; Base.call(this, o); });
kind(function B(o) { this.b = 1; this.c = 2; Base.call(this, o); });
kind(function C(o) { Base.call(this, o); this.d = 2; });
kind(function D(o) { this.third = 0; Base.call(this, o); });
kind(function E(o) { this.second = 9; this.first = 8; Base.call(this, o); });
kind(function F(o) { if (o & 2) this.early = o; Base.call(this, o); if (o & 4) this.late = o; });
kind(function G(o) { this.sixth = 0; this.fourth = 0; Base.call(this, o); });
kind(function H(o) { Base.call(this, o); Base.call(this, o + 1); });
kind(function I(o) { this["x" + (o & 3)] = o; Base.call(this, o); });
kind(function J(o) { Base.call(this, o); delete this.second; Base.call(this, o); });
kind(function K(o) { if (o & 8) Object.preventExtensions(this); try { Base.call(this, o); } catch (error) { failures.push(error.constructor.name); } });
kind(function L(o) { Object.defineProperty(this, "second", { value: 7, enumerable: false, writable: true, configurable: true }); Base.call(this, o); });
class M extends Base { m = 1; constructor(o) { super(o); this.n = 2; } }
class N extends M { before = 0; constructor(o) { super(o); this.after = 1; } }
kinds.push(M, N);

const seen = new Map();
function note(object, name, o) {
  const text = name + " " + (o % 24) + ": " + Object.keys(object).join() + " | " + JSON.stringify(object) + " | " + object.sum();
  const key = name + " " + (o % 24);
  if (!seen.has(key)) seen.set(key, text);
  else if (seen.get(key) !== text) console.log("CHANGED", seen.get(key), "=>", text);
}
for (let round = 0; round < 60; round++) {
  // In turn, in runs of one kind, backwards, and by a stride that never repeats the neighbour.
  for (let i = 0; i < kinds.length * 24; i++) {
    const at = round % 4 === 0 ? i % kinds.length : round % 4 === 1 ? Math.floor(i / 24) : round % 4 === 2 ? kinds.length - 1 - (i % kinds.length) : (i * 5) % kinds.length;
    const o = round % 4 === 1 ? i % 24 : Math.floor(i / kinds.length) % 24;
    note(new kinds[at](o), kinds[at].name, o);
  }
}
for (const text of [...seen.values()].sort()) console.log(text);
console.log(failures.length, [...new Set(failures)].join());

// GENERATED: I L M
// CHECK-LABEL: function {{*}}name="I"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="x"
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = BitAnd v1, v4
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: ElemSet v2, v6, v1
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = PropGet v8 key="call"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v10, v8, v11, v1 calleeKey="call" calleeName="Base.call"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="L"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_4]] flags=[IsExpected]} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="second"
// CHECK-NEXT: v6 = Integer integer=7
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject -, v6 layout=[[L_6]] fields=[4]
// CHECK-NEXT: PropDefine v9, v8 key="enumerable"
// CHECK-NEXT: v11 = Boolean boolean=true
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v9, v12 key="writable"
// CHECK-NEXT: v14 = Boolean boolean=true
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v9, v15 key="configurable"
// CHECK-NEXT: v17 = FinishObject v9
// CHECK-NEXT: v18 = Call v3, v2, v4, v5, v17 calleeName="Object.defineProperty"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v20 = PropGet v19 key="call"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v21, v19, v22, v1 calleeKey="call" calleeName="Base.call"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="M"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_9]]
// CHECK-NEXT: v10 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v14, v16 key="n"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b11(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="M"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b12(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
