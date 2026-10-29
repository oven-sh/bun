// RUN: lower
// OPTIONS: builtin-modules

// Downleveled private members of class expressions that functions return: the helpers of tslib. The collection is declared before the function, behind it, or in it, and code outside the class uses the collection too.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
var __classPrivateFieldGet = function (receiver, state, kind, f) { if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it"); return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver); };
var __classPrivateFieldSet = function (receiver, state, value, kind, f) { if (kind === "m") throw new TypeError("Private method is not writable"); if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter"); if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it"); return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value; };
var __classPrivateFieldIn = function (state, receiver) { if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object"); return typeof state === "function" ? receiver === state : state.has(receiver); };
const m1 = new WeakMap();
const make1 = () => class { constructor(v) { m1.set(this, v); } read() { return __classPrivateFieldGet(this, m1, "f"); } };
const C1 = make1();
function f1() { const o = new C1(7); m1.set(o, 9); return [o.read(), o.read()].join(); }
show("declared before the factory, code outside the class stores an entry", () => f1());
const m2 = new WeakMap();
const make2 = () => class { constructor(v) { m2.set(this, v); } read() { return __classPrivateFieldGet(this, m2, "f"); } };
class S2 extends make2() {}
show("declared before the factory, a subclass instance reads", () => new S2(7).read());
const m3 = new WeakMap();
const make3 = () => class { constructor(v) { m3.set(this, v); } read() { return __classPrivateFieldGet(this, m3, "f"); } };
const C3 = make3();
show("declared before the factory, two instances read", () => [new C3(7).read(), new C3(8).read()]);
const m4 = new WeakMap();
const make4 = () => class { constructor(v) { m4.set(this, v); } read() { return __classPrivateFieldGet(this, m4, "f"); } };
const A4 = make4(), B4 = make4();
const a4 = new A4(1), b4 = new B4(2);
show("declared before the factory, two classes share the collection", () => [a4.read(), b4.read(), A4.prototype.read.call(b4), B4.prototype.read.call(a4)]);
const m5 = new WeakMap();
const make5 = () => class { constructor(v) { m5.set(this, v); } read() { return __classPrivateFieldGet(this, m5, "f"); } };
const C5 = make5();
const o5 = new C5(7);
show("declared before the factory, code outside the class asks and deletes, before", () => [m5.has(o5), m5.get(o5), m5.delete(o5), m5.has(o5)]);
show("declared before the factory, code outside the class asks and deletes", () => o5.read());
const m6 = new WeakMap();
const make6 = () => class { constructor(v) { m6.set(this, v); } read() { return __classPrivateFieldGet(this, m6, "f"); } };
const C6 = make6();
const s6 = {}; m6.set(s6, 'stranger');
show("declared before the factory, an object of no class has an entry", () => [C6.prototype.read.call(s6), new C6(1).read()]);
var m7;
const make7 = () => class { constructor(v) { m7.set(this, v); } read() { return __classPrivateFieldGet(this, m7, "f"); } };
m7 = new WeakMap();
const C7 = make7();
function f7() { const o = new C7(7); m7.set(o, 9); return [o.read(), o.read()].join(); }
show("a var that is filled behind the factory, code outside the class stores an entry", () => f7());
var m8;
const make8 = () => class { constructor(v) { m8.set(this, v); } read() { return __classPrivateFieldGet(this, m8, "f"); } };
m8 = new WeakMap();
class S8 extends make8() {}
show("a var that is filled behind the factory, a subclass instance reads", () => new S8(7).read());
var m9;
const make9 = () => class { constructor(v) { m9.set(this, v); } read() { return __classPrivateFieldGet(this, m9, "f"); } };
m9 = new WeakMap();
const C9 = make9();
show("a var that is filled behind the factory, two instances read", () => [new C9(7).read(), new C9(8).read()]);
var m10;
const make10 = () => class { constructor(v) { m10.set(this, v); } read() { return __classPrivateFieldGet(this, m10, "f"); } };
m10 = new WeakMap();
const A10 = make10(), B10 = make10();
const a10 = new A10(1), b10 = new B10(2);
show("a var that is filled behind the factory, two classes share the collection", () => [a10.read(), b10.read(), A10.prototype.read.call(b10), B10.prototype.read.call(a10)]);
var m11;
const make11 = () => class { constructor(v) { m11.set(this, v); } read() { return __classPrivateFieldGet(this, m11, "f"); } };
m11 = new WeakMap();
const C11 = make11();
const o11 = new C11(7);
show("a var that is filled behind the factory, code outside the class asks and deletes, before", () => [m11.has(o11), m11.get(o11), m11.delete(o11), m11.has(o11)]);
show("a var that is filled behind the factory, code outside the class asks and deletes", () => o11.read());
var m12;
const make12 = () => class { constructor(v) { m12.set(this, v); } read() { return __classPrivateFieldGet(this, m12, "f"); } };
m12 = new WeakMap();
const C12 = make12();
const s12 = {}; m12.set(s12, 'stranger');
show("a var that is filled behind the factory, an object of no class has an entry", () => [C12.prototype.read.call(s12), new C12(1).read()]);
var m13;
const make13 = () => { m13 = new WeakMap(); return class { constructor(v) { m13.set(this, v); } read() { return __classPrivateFieldGet(this, m13, "f"); } }; };
const C13 = make13();
function f13() { const o = new C13(7); m13.set(o, 9); return [o.read(), o.read()].join(); }
show("created by each call of the factory, code outside the class stores an entry", () => f13());
var m14;
const make14 = () => { m14 = new WeakMap(); return class { constructor(v) { m14.set(this, v); } read() { return __classPrivateFieldGet(this, m14, "f"); } }; };
class S14 extends make14() {}
show("created by each call of the factory, a subclass instance reads", () => new S14(7).read());
var m15;
const make15 = () => { m15 = new WeakMap(); return class { constructor(v) { m15.set(this, v); } read() { return __classPrivateFieldGet(this, m15, "f"); } }; };
const C15 = make15();
show("created by each call of the factory, two instances read", () => [new C15(7).read(), new C15(8).read()]);
var m16;
const make16 = () => { m16 = new WeakMap(); return class { constructor(v) { m16.set(this, v); } read() { return __classPrivateFieldGet(this, m16, "f"); } }; };
const A16 = make16(), B16 = make16();
const a16 = new A16(1), b16 = new B16(2);
show("created by each call of the factory, two classes share the collection", () => [a16.read(), b16.read(), A16.prototype.read.call(b16), B16.prototype.read.call(a16)]);
var m17;
const make17 = () => { m17 = new WeakMap(); return class { constructor(v) { m17.set(this, v); } read() { return __classPrivateFieldGet(this, m17, "f"); } }; };
const C17 = make17();
const o17 = new C17(7);
show("created by each call of the factory, code outside the class asks and deletes, before", () => [m17.has(o17), m17.get(o17), m17.delete(o17), m17.has(o17)]);
show("created by each call of the factory, code outside the class asks and deletes", () => o17.read());
var m18;
const make18 = () => { m18 = new WeakMap(); return class { constructor(v) { m18.set(this, v); } read() { return __classPrivateFieldGet(this, m18, "f"); } }; };
const C18 = make18();
const s18 = {}; m18.set(s18, 'stranger');
show("created by each call of the factory, an object of no class has an entry", () => [C18.prototype.read.call(s18), new C18(1).read()]);
let m19 = new WeakMap();
const make19 = () => { const inner = new WeakMap(); m19 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C19 = make19();
function f19() { const o = new C19(7); m19.set(o, 9); return [o.read(), o.read()].join(); }
show("a variable of the factory, code outside the class stores an entry", () => f19());
let m20 = new WeakMap();
const make20 = () => { const inner = new WeakMap(); m20 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
class S20 extends make20() {}
show("a variable of the factory, a subclass instance reads", () => new S20(7).read());
let m21 = new WeakMap();
const make21 = () => { const inner = new WeakMap(); m21 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C21 = make21();
show("a variable of the factory, two instances read", () => [new C21(7).read(), new C21(8).read()]);
let m22 = new WeakMap();
const make22 = () => { const inner = new WeakMap(); m22 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const A22 = make22(), B22 = make22();
const a22 = new A22(1), b22 = new B22(2);
show("a variable of the factory, two classes share the collection", () => [a22.read(), b22.read(), A22.prototype.read.call(b22), B22.prototype.read.call(a22)]);
let m23 = new WeakMap();
const make23 = () => { const inner = new WeakMap(); m23 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C23 = make23();
const o23 = new C23(7);
show("a variable of the factory, code outside the class asks and deletes, before", () => [m23.has(o23), m23.get(o23), m23.delete(o23), m23.has(o23)]);
show("a variable of the factory, code outside the class asks and deletes", () => o23.read());
let m24 = new WeakMap();
const make24 = () => { const inner = new WeakMap(); m24 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner, "f"); } }; };
const C24 = make24();
const s24 = {}; m24.set(s24, 'stranger');
show("a variable of the factory, an object of no class has an entry", () => [C24.prototype.read.call(s24), new C24(1).read()]);
const w25 = new WeakSet();
class P25 {}
const mix25 = Base => class extends Base { constructor(v) { super(); w25.add(this); this.v = v; } is() { return __classPrivateFieldIn(w25, this); } };
class S25 extends mix25(P25) {}
show("a WeakSet, a subclass of a mixin with a field", () => new S25(7).is());
const w26 = new WeakSet();
class P26 {}
const mix26 = Base => class extends Base { constructor(v) { super(); w26.add(this); } is() { return __classPrivateFieldIn(w26, this); } };
class S26 extends mix26(P26) {}
show("a WeakSet, a subclass of a mixin", () => new S26(7).is());
const w27 = new WeakSet();
const mix27 = Base => class extends Base { constructor(v) { super(); w27.add(this); this.v = v; } is() { return __classPrivateFieldIn(w27, this); } };
const C27 = mix27(Object);
show("a WeakSet, the class of a mixin", () => [new C27(7).is(), C27.prototype.is.call({})]);
const w28 = new WeakSet();
const mix28 = Base => class extends Base { is() { return __classPrivateFieldIn(w28, this); } };
const C28 = mix28(Object);
const o28 = new C28();
show("a WeakSet, code outside the class adds and deletes", () => (() => { const r = [o28.is()]; w28.add(o28); r.push(o28.is()); w28.delete(o28); r.push(o28.is()); return r; })());
const makeEmitted = (Base = Object) => { var _x, _a; return _a = class extends Base { constructor(v) { super(); _x.set(this, void 0); __classPrivateFieldSet(this, _x, v, "f"); } read() { return __classPrivateFieldGet(this, _x, "f"); } }, _x = new WeakMap(), _a; };
class EmittedBelow extends makeEmitted() {}
const EmittedA = makeEmitted(), EmittedB = makeEmitted();
show("as TypeScript emits a class expression, a subclass instance reads", () => new EmittedBelow(7).read());
show("as TypeScript emits a class expression, two classes", () => [new EmittedA(1).read(), new EmittedB(2).read()]);
show("as TypeScript emits a class expression, an instance of the other class is refused", () => EmittedA.prototype.read.call(new EmittedB(2)));
var _inst = new WeakSet(), _step = function () { return 3; };
const makeWithMethod = () => class { constructor() { _inst.add(this); } run() { return __classPrivateFieldGet(this, _inst, "m", _step).call(this); } };
class WithMethod extends makeWithMethod() {}
show("a private method", () => new WithMethod().run());
const makeWithStatic = () => { var _a, _C_n; return _a = class C { static take() { var _b; return __classPrivateFieldSet(_a, _a, (_b = __classPrivateFieldGet(_a, _a, "f", _C_n), _b++, _b), "f", _C_n); } }, _C_n = { value: 1 }, _a; };
const WithStatic = makeWithStatic();
show("a private static field", () => [WithStatic.take(), WithStatic.take()]);

// GENERATED: S2 makeWithStatic _a
// CHECK-LABEL: function {{*}}name="S2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeWithStatic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewObject -, v0, v0 layout=[[L_5]] fields=[0, 1]
// CHECK-NEXT: v2 = NewClosure function=[[f_6]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_7]]
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_8]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_7]] side=Static key="take"
// CHECK-NEXT: v6 = FinishClass v3 layout=[[L_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Convert v6 declared={type=undefined|null|[[L_9]]|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v8 layout=[[L_5]]
// CHECK-NEXT: v10 = Data data=[[d_10]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_11]]|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v11 layout=[[L_5]] field=1
// CHECK-NEXT: v13 = GetEnvironmentField v1 layout=[[L_5]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee] length=1 captures=[{type=env [[L_13]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: env [[L_13]], v1: function, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v1
// CHECK-NEXT: v6 = SuperConstruct v5, v2 layout=[[L_15]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v11 = PropGet v10 key="set"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_16]] flags=[IsExpected]}
// CHECK-NEXT: v13 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v14) frequency=Unlikely:
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = Call v12, v10, v17, v18 calleeKey="set" calleeName="_x.set"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v21 = TypeTest v16 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v26 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v27 = String string="f"
// CHECK-NEXT: v28 = Call v20, -, v25, v26, v3, v27 calleeName="__classPrivateFieldSet"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: v30 = TypeTest v29 testedType=object
// CHECK-NEXT: Branch v30 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: Jump -> next b12(v31)
// CHECK-NEXT: b8(v32):
// CHECK-NEXT: v33 = TypeTest v32 testedType=undefined
// CHECK-NEXT: Branch v33 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v34):
// CHECK-NEXT: v35 = TypeTest v24 testedType=absent
// CHECK-NEXT: Branch v35 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v36) frequency=Unlikely:
// CHECK-NEXT: v37 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v37
// CHECK-NEXT: b11(v38):
// CHECK-NEXT: Jump -> next b12(v38)
// CHECK-NEXT: b12(v39):
// CHECK-NEXT: Return v39
// CHECK-NEXT: b13(v40) frequency=Unlikely:
// CHECK-NEXT: v41 = NewRuntimeError runtimeError=DerivedConstructorResult
// CHECK-NEXT: Throw v41
// CHECK-NEXT: b14(v42) frequency=Unlikely:
// CHECK-NEXT: v43 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v43
// CHECK-NEXT: }
