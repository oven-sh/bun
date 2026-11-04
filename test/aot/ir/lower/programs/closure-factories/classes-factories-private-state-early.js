// RUN: lower
// OPTIONS: builtin-modules

// Downleveled private members of class expressions that functions return: the helpers that TypeScript 3.8 emitted. The collection is declared before the function, behind it, or in it, and code outside the class uses the collection too.
function show(label, f) { let shown; try { shown = JSON.stringify(f()); } catch (error) { shown = error.constructor.name; } console.log(label + ": " + shown); }
var __classPrivateFieldGet = function (receiver, privateMap) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to get private field on non-instance"); } return privateMap.get(receiver); };
var __classPrivateFieldSet = function (receiver, privateMap, value) { if (!privateMap.has(receiver)) { throw new TypeError("attempted to set private field on non-instance"); } privateMap.set(receiver, value); return value; };
const m1 = new WeakMap();
const make1 = () => class { constructor(v) { m1.set(this, v); } read() { return __classPrivateFieldGet(this, m1); } };
const C1 = make1();
function f1() { const o = new C1(7); m1.set(o, 9); return [o.read(), o.read()].join(); }
show("declared before the factory, code outside the class stores an entry", () => f1());
const m2 = new WeakMap();
const make2 = () => class { constructor(v) { m2.set(this, v); } read() { return __classPrivateFieldGet(this, m2); } };
class S2 extends make2() {}
show("declared before the factory, a subclass instance reads", () => new S2(7).read());
const m3 = new WeakMap();
const make3 = () => class { constructor(v) { m3.set(this, v); } read() { return __classPrivateFieldGet(this, m3); } };
const C3 = make3();
show("declared before the factory, two instances read", () => [new C3(7).read(), new C3(8).read()]);
const m4 = new WeakMap();
const make4 = () => class { constructor(v) { m4.set(this, v); } read() { return __classPrivateFieldGet(this, m4); } };
const A4 = make4(), B4 = make4();
const a4 = new A4(1), b4 = new B4(2);
show("declared before the factory, two classes share the collection", () => [a4.read(), b4.read(), A4.prototype.read.call(b4), B4.prototype.read.call(a4)]);
const m5 = new WeakMap();
const make5 = () => class { constructor(v) { m5.set(this, v); } read() { return __classPrivateFieldGet(this, m5); } };
const C5 = make5();
const o5 = new C5(7);
show("declared before the factory, code outside the class asks and deletes, before", () => [m5.has(o5), m5.get(o5), m5.delete(o5), m5.has(o5)]);
show("declared before the factory, code outside the class asks and deletes", () => o5.read());
const m6 = new WeakMap();
const make6 = () => class { constructor(v) { m6.set(this, v); } read() { return __classPrivateFieldGet(this, m6); } };
const C6 = make6();
const s6 = {}; m6.set(s6, 'stranger');
show("declared before the factory, an object of no class has an entry", () => [C6.prototype.read.call(s6), new C6(1).read()]);
var m7;
const make7 = () => class { constructor(v) { m7.set(this, v); } read() { return __classPrivateFieldGet(this, m7); } };
m7 = new WeakMap();
const C7 = make7();
function f7() { const o = new C7(7); m7.set(o, 9); return [o.read(), o.read()].join(); }
show("a var that is filled behind the factory, code outside the class stores an entry", () => f7());
var m8;
const make8 = () => class { constructor(v) { m8.set(this, v); } read() { return __classPrivateFieldGet(this, m8); } };
m8 = new WeakMap();
class S8 extends make8() {}
show("a var that is filled behind the factory, a subclass instance reads", () => new S8(7).read());
var m9;
const make9 = () => class { constructor(v) { m9.set(this, v); } read() { return __classPrivateFieldGet(this, m9); } };
m9 = new WeakMap();
const C9 = make9();
show("a var that is filled behind the factory, two instances read", () => [new C9(7).read(), new C9(8).read()]);
var m10;
const make10 = () => class { constructor(v) { m10.set(this, v); } read() { return __classPrivateFieldGet(this, m10); } };
m10 = new WeakMap();
const A10 = make10(), B10 = make10();
const a10 = new A10(1), b10 = new B10(2);
show("a var that is filled behind the factory, two classes share the collection", () => [a10.read(), b10.read(), A10.prototype.read.call(b10), B10.prototype.read.call(a10)]);
var m11;
const make11 = () => class { constructor(v) { m11.set(this, v); } read() { return __classPrivateFieldGet(this, m11); } };
m11 = new WeakMap();
const C11 = make11();
const o11 = new C11(7);
show("a var that is filled behind the factory, code outside the class asks and deletes, before", () => [m11.has(o11), m11.get(o11), m11.delete(o11), m11.has(o11)]);
show("a var that is filled behind the factory, code outside the class asks and deletes", () => o11.read());
var m12;
const make12 = () => class { constructor(v) { m12.set(this, v); } read() { return __classPrivateFieldGet(this, m12); } };
m12 = new WeakMap();
const C12 = make12();
const s12 = {}; m12.set(s12, 'stranger');
show("a var that is filled behind the factory, an object of no class has an entry", () => [C12.prototype.read.call(s12), new C12(1).read()]);
var m13;
const make13 = () => { m13 = new WeakMap(); return class { constructor(v) { m13.set(this, v); } read() { return __classPrivateFieldGet(this, m13); } }; };
const C13 = make13();
function f13() { const o = new C13(7); m13.set(o, 9); return [o.read(), o.read()].join(); }
show("created by each call of the factory, code outside the class stores an entry", () => f13());
var m14;
const make14 = () => { m14 = new WeakMap(); return class { constructor(v) { m14.set(this, v); } read() { return __classPrivateFieldGet(this, m14); } }; };
class S14 extends make14() {}
show("created by each call of the factory, a subclass instance reads", () => new S14(7).read());
var m15;
const make15 = () => { m15 = new WeakMap(); return class { constructor(v) { m15.set(this, v); } read() { return __classPrivateFieldGet(this, m15); } }; };
const C15 = make15();
show("created by each call of the factory, two instances read", () => [new C15(7).read(), new C15(8).read()]);
var m16;
const make16 = () => { m16 = new WeakMap(); return class { constructor(v) { m16.set(this, v); } read() { return __classPrivateFieldGet(this, m16); } }; };
const A16 = make16(), B16 = make16();
const a16 = new A16(1), b16 = new B16(2);
show("created by each call of the factory, two classes share the collection", () => [a16.read(), b16.read(), A16.prototype.read.call(b16), B16.prototype.read.call(a16)]);
var m17;
const make17 = () => { m17 = new WeakMap(); return class { constructor(v) { m17.set(this, v); } read() { return __classPrivateFieldGet(this, m17); } }; };
const C17 = make17();
const o17 = new C17(7);
show("created by each call of the factory, code outside the class asks and deletes, before", () => [m17.has(o17), m17.get(o17), m17.delete(o17), m17.has(o17)]);
show("created by each call of the factory, code outside the class asks and deletes", () => o17.read());
var m18;
const make18 = () => { m18 = new WeakMap(); return class { constructor(v) { m18.set(this, v); } read() { return __classPrivateFieldGet(this, m18); } }; };
const C18 = make18();
const s18 = {}; m18.set(s18, 'stranger');
show("created by each call of the factory, an object of no class has an entry", () => [C18.prototype.read.call(s18), new C18(1).read()]);
let m19 = new WeakMap();
const make19 = () => { const inner = new WeakMap(); m19 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
const C19 = make19();
function f19() { const o = new C19(7); m19.set(o, 9); return [o.read(), o.read()].join(); }
show("a variable of the factory, code outside the class stores an entry", () => f19());
let m20 = new WeakMap();
const make20 = () => { const inner = new WeakMap(); m20 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
class S20 extends make20() {}
show("a variable of the factory, a subclass instance reads", () => new S20(7).read());
let m21 = new WeakMap();
const make21 = () => { const inner = new WeakMap(); m21 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
const C21 = make21();
show("a variable of the factory, two instances read", () => [new C21(7).read(), new C21(8).read()]);
let m22 = new WeakMap();
const make22 = () => { const inner = new WeakMap(); m22 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
const A22 = make22(), B22 = make22();
const a22 = new A22(1), b22 = new B22(2);
show("a variable of the factory, two classes share the collection", () => [a22.read(), b22.read(), A22.prototype.read.call(b22), B22.prototype.read.call(a22)]);
let m23 = new WeakMap();
const make23 = () => { const inner = new WeakMap(); m23 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
const C23 = make23();
const o23 = new C23(7);
show("a variable of the factory, code outside the class asks and deletes, before", () => [m23.has(o23), m23.get(o23), m23.delete(o23), m23.has(o23)]);
show("a variable of the factory, code outside the class asks and deletes", () => o23.read());
let m24 = new WeakMap();
const make24 = () => { const inner = new WeakMap(); m24 = inner; return class { constructor(v) { inner.set(this, v); } read() { return __classPrivateFieldGet(this, inner); } }; };
const C24 = make24();
const s24 = {}; m24.set(s24, 'stranger');
show("a variable of the factory, an object of no class has an entry", () => [C24.prototype.read.call(s24), new C24(1).read()]);

// GENERATED: show __classPrivateFieldGet S2 make19
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = PropGet v10 key="constructor"
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=": "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Add v21, v14
// CHECK-NEXT: v23 = Call v19, v17, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__classPrivateFieldGet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]]|[[L_5]]|[[L_6]]|[[L_7]]|[[L_8]]|[[L_9]]|[[L_10]]|[[L_11]]|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]]|[[L_17]]|[[L_18]]|[[L_19]]|[[L_20]]|[[L_21]]|[[L_22]]|[[L_23]]|[[L_24]] flags=[IsExpected]}, {type=undefined|null|WeakMap<undefined|null|symbol|object, anything> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]]|[[L_5]]|[[L_6]]|[[L_7]]|[[L_8]]|[[L_9]]|[[L_10]]|[[L_11]]|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]]|[[L_17]]|[[L_18]]|[[L_19]]|[[L_20]]|[[L_21]]|[[L_22]]|[[L_23]]|[[L_24]], v1: undefined|null|WeakMap<undefined|null|symbol|object, anything>):
// CHECK-NEXT: v2 = PropGet v1 key="has"
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeKey="has" calleeName="privateMap.has"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = PropGet v1 key="get"
// CHECK-NEXT: v7 = Call v6, v1, v0 calleeKey="get" calleeName="privateMap.get"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="TypeError" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="attempted to get private field on non-instance"
// CHECK-NEXT: v13 = Construct v11, -, v12 calleeName="TypeError"
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="S2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_25]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_26]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_26]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make19"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="WeakMap" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(WeakMap) flags=[IsExpected]}
// CHECK-NEXT: v3 = Construct v2 calleeName="WeakMap"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_27]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="m19"
// CHECK-NEXT: v6 = Convert v3 declared={type=undefined|null|WeakMap<undefined|null|symbol|object, anything> flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_27]]
// CHECK-NEXT: v8 = NewClosure v3 function=[[f_28]]
// CHECK-NEXT: v9 = NewClass v8 layout=[[L_19]]
// CHECK-NEXT: v10 = NewClosure v3 function=[[f_29]]
// CHECK-NEXT: DefineMethod v9, v10 layout=[[L_19]] key="read"
// CHECK-NEXT: v12 = FinishClass v9 layout=[[L_19]]
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
