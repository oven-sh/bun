// RUN: lower
// OPTIONS: builtin-modules

// Static methods that use instance private names on `this`, and instance methods that use static ones, which type-checks but throws at run time.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
class InstanceFromStatic { #f() { return 42; } #v = 7; get #g() { return 8; } static m() { return this.#f(); } static v() { return this.#v; } static g() { return this.#g; } static put(x) { this.#v = x; return this.#v; } static has() { return #f in this; } }
row("an instance method from a static method, on an instance", () => InstanceFromStatic.m.call(new InstanceFromStatic()));
row("an instance method from a static method, on the class", () => InstanceFromStatic.m());
row("an instance field from a static method", () => [said(() => InstanceFromStatic.v.call(new InstanceFromStatic())), said(() => InstanceFromStatic.v())].join());
row("an instance getter from a static method", () => [said(() => InstanceFromStatic.g.call(new InstanceFromStatic())), said(() => InstanceFromStatic.g())].join());
row("a store from a static method", () => [said(() => InstanceFromStatic.put.call(new InstanceFromStatic(), 3)), said(() => InstanceFromStatic.put(3))].join());
row("in, from a static method", () => [InstanceFromStatic.has(), InstanceFromStatic.has.call(new InstanceFromStatic())].join());
class StaticFromInstance { static #f() { return 42; } static #v = 7; static get #g() { return 8; } m() { return this.#f(); } v() { return this.#v; } g() { return this.#g; } put(x) { this.#v = x; return this.#v; } }
const sfi = new StaticFromInstance();
row("a static method from an instance method, on the class", () => sfi.m.call(StaticFromInstance));
row("a static method from an instance method, on an instance", () => sfi.m());
row("a static field from an instance method", () => [said(() => sfi.v.call(StaticFromInstance)), said(() => sfi.v())].join());
row("a static getter from an instance method", () => [said(() => sfi.g.call(StaticFromInstance)), said(() => sfi.g())].join());
row("a store from an instance method", () => [said(() => sfi.put.call(StaticFromInstance, 3)), said(() => sfi.put(3))].join());
class A { static #m() { return "A"; } #i = "a"; static own() { return A.#m(); } static ofB() { return said(() => B.#m()) + " " + said(() => new B().#i); } }
class B { static #m() { return "B"; } #i = "b"; static own() { return B.#m(); } static ofA() { return said(() => A.#m()) + " " + said(() => new A().#i); } }
row("another class's member of the same name", () => [A.own(), B.own(), A.ofB(), B.ofA()].join(" | "));
class Outer {
  static #x = "outer"; #y = "outer y";
  static Inner = class Inner {
    static #x = "inner"; #y = "inner y";
    static own() { return Inner.#x + " " + new Inner().#y; }
    static ofOuter() { return said(() => Outer.#x) + " " + said(() => new Outer().#y); }
  };
  static own() { return Outer.#x + " " + new Outer().#y; }
  static ofInner() { return said(() => Outer.Inner.#x) + " " + said(() => new Outer.Inner().#y); }
}
row("a name that an inner class declares again", () => [Outer.own(), Outer.Inner.own(), Outer.Inner.ofOuter(), Outer.ofInner()].join(" | "));
function make(n) { return class K { #f() { return n; } static #s() { return -n; } static viaStatic(o) { return o.#f(); } viaInstance(o) { return o.#s(); } }; }
const K1 = make(1), K2 = make(2);
row("made twice", () => [said(() => K1.viaStatic(new K1())), said(() => K1.viaStatic(new K2())), said(() => K1.viaStatic(K1)), said(() => new K1().viaInstance(K1)), said(() => new K1().viaInstance(K2)), said(() => new K1().viaInstance(new K1()))].join());
row("on what is no object", () => [said(() => InstanceFromStatic.m.call(1)), said(() => InstanceFromStatic.m.call(null)), said(() => sfi.m.call("s")), said(() => sfi.m.call(undefined))].join());

// GENERATED: make put K viaInstance
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewClassToken layout=[[L_1]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_2]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_1]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v6 = NewClosure v1, v4 function=[[f_5]]
// CHECK-NEXT: DefineMethod v3, v6 layout=[[L_1]] side=Static key="viaStatic"
// CHECK-NEXT: v8 = NewClosure v3, v5 function=[[f_6]]
// CHECK-NEXT: DefineMethod v3, v8 layout=[[L_1]] index=1 key="viaInstance"
// CHECK-NEXT: v10 = FinishClass v3 layout=[[L_1]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=function flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: PrivateSet v0, v2, v1 layout=[[L_8]] field=1
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v5 = PrivateGet v0, v4 layout=[[L_8]] field=1
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_9]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v3 = StrictEq v0, v2
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b10()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v5 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_11]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v11 = StrictEq v0, v10
// CHECK-NEXT: Branch v11 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v13 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v17 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v18):
// CHECK-NEXT: v19 = PropGet v18 key="#v"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b9(v20):
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v21
// CHECK-NEXT: b10():
// CHECK-NEXT: v22 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v22 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v23):
// CHECK-NEXT: v24 = PropGet v23 key="#v"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b12(v25):
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_12]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaInstance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|object):
// CHECK-NEXT: v3 = StrictEq v2, v0
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Call v1, v2 calleeName="o.#s"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
