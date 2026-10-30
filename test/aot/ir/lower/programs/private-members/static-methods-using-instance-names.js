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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClassToken layout=[[L_2]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_2]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v6 = NewClosure v1, v4 function=[[f_6]]
// CHECK-NEXT: DefineMethod v3, v6 layout=[[L_2]] side=Static key="viaStatic"
// CHECK-NEXT: v8 = NewClosure v3, v5 function=[[f_7]]
// CHECK-NEXT: DefineMethod v3, v8 layout=[[L_2]] index=1 key="viaInstance"
// CHECK-NEXT: v10 = FinishClass v3 layout=[[L_2]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=function flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: PrivateSet v2, v4, v3 layout=[[L_11]] field=1
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v8 = PrivateGet v6, v7 layout=[[L_11]] field=1
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_12]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: [[L_12]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b9()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_15]]
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v14 = StrictEq v12, v13
// CHECK-NEXT: Branch v14 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v16 = TypeTest v15 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v17) frequency=Unlikely:
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: b8() frequency=Unlikely:
// CHECK-NEXT: v20 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v20
// CHECK-NEXT: b9() frequency=Unlikely:
// CHECK-NEXT: v21 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_16]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaInstance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 captures=[{type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = StrictEq v2, v0
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Call v1, v2 calleeName="o.#s"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
