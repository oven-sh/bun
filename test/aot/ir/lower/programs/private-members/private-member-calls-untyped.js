// RUN: lower
// OPTIONS: builtin-modules

// Calls of private methods, fields holding functions, and getters returning functions: what `this` is, with spread arguments and optional chains (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function who(t, C) { return t === C ? "the class" : t === undefined ? "undefined" : typeof t; }
function make(n) {
  return class C {
    static #m(...a) { return "m" + n + " " + who(this, C) + " " + a.length; }
    static #f = function (...a) { return "f" + n + " " + who(this, C) + " " + a.length; };
    static #arrow = (...a) => "arrow" + n + " " + a.length;
    static #reads = 0;
    static get #g() { C.#reads++; return function (...a) { return "g" + n + " " + who(this, C) + " " + a.length + " read " + C.#reads; }; }
    static #none = undefined;
    static #K = class { v = n; };
    static rows() {
      row("plain m", () => C.#m(1));
      row("plain f", () => C.#f(1));
      row("plain g", () => C.#g(1));
      row("plain arrow", () => C.#arrow(1));
      row("this m", () => C.viaThis());
      row("spread m", () => C.#m(...[1, 2, 3]));
      row("spread f", () => C.#f(...[1, 2, 3]));
      row("spread g", () => C.#g(...[1, 2, 3]));
      row("parenthesized m", () => (C.#m)(1));
      row("parenthesized f", () => (C.#f)(1));
      row("parenthesized g", () => (C.#g)(1));
      row("comma m", () => (0, C.#m)(1));
      row("comma f", () => (0, C.#f)(1));
      row("tag m", () => C.#m`a${1}b`);
      row("tag f", () => C.#f`a${1}b`);
      row("tag g", () => C.#g`a${1}b`);
      row("tag arrow", () => C.#arrow`a${1}b`);
      row("tag on this", () => C.tagOnThis());
      row("chain m", () => C?.#m(1));
      row("chain f", () => C?.#f(1));
      row("chain g", () => C?.#g(1));
      row("optional call m", () => C.#m?.(1));
      row("optional call f", () => C.#f?.(1));
      row("optional call g", () => C.#g?.(1));
      row("optional call of nothing", () => C.#none?.(1));
      row("call of nothing", () => (C.#none)(1));
      row("both chains m", () => C?.#m?.(1));
      row("call", () => C.#m.call(5, 1, 2));
      row("apply", () => C.#m.apply(C, [1, 2]));
      row("bind", () => C.#m.bind(C)(1));
      row("Reflect.apply", () => Reflect.apply(C.#m, undefined, [1]));
      row("held", () => { const f = C.#m; return f(1); });
      row("new of the method", () => new (C.#m)());
      row("new of a class in a field", () => new C.#K().v);
      row("new of a class in a field, no list", () => (new C.#K).v);
      row("chain in parentheses m", () => (C?.#m)(1));
      row("chain in parentheses f", () => (C?.#f)(1));
      row("chain in parentheses g", () => (C?.#g)(1));
      row("chain in parentheses of null", () => { const o = null; return (o?.#m)(1); });
      row("chain in parentheses, optional call", () => { const o = null; return (o?.#m)?.(1); });
      row("chain in parentheses on another", () => { const o = {}; return (o?.#m)(1); });
    }
    static viaThis() { return this.#m(1); }
    static tagOnThis() { return this.#m`a`; }
  };
}
make(1).rows();
make(2).rows();
class T {
  static #m(...a) { return "m " + who(this, T) + " " + a.length; }
  static #f = function (...a) { return "f " + who(this, T) + " " + a.length; };
  static get #g() { return function (...a) { return "g " + who(this, T) + " " + a.length; }; }
  static x = T.#m`a`;
  static y = T.#f`a`;
  static z = T.#g`a`;
  static {
    row("top tag m", () => T.#m`a${1}`);
    row("top tag f", () => T.#f`a${1}`);
    row("top tag g", () => T.#g`a${1}`);
    row("top tag on this", () => T.tag());
    row("top in initializers", () => [T.x, T.y, T.z].join());
    row("top chain in parentheses m", () => (T?.#m)(1));
    row("top chain in parentheses f", () => (T?.#f)(1));
    row("top chain in parentheses g", () => (T?.#g)(1));
  }
  static tag() { return this.#m`a`; }
}

// GENERATED: make T #g tagOnThis
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject layout=[[L_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_5]]
// CHECK-NEXT: v5 = NewClosure v1, v0 function=[[f_6]]
// CHECK-NEXT: v6 = NewClosure v1, v2, v0, v4 function=[[f_7]]
// CHECK-NEXT: v7 = NewClosure v1, v2, v4, v5, v6 function=[[f_8]]
// CHECK-NEXT: DefineMethod v4, v7 layout=[[L_5]] side=Static key="rows"
// CHECK-NEXT: v9 = NewClosure v4, v5 function=[[f_9]]
// CHECK-NEXT: DefineMethod v4, v9 layout=[[L_5]] side=Static index=1 key="viaThis"
// CHECK-NEXT: v11 = NewClosure v4, v5 function=[[f_10]]
// CHECK-NEXT: DefineMethod v4, v11 layout=[[L_5]] side=Static index=2 key="tagOnThis"
// CHECK-NEXT: v13 = FinishClass v4 layout=[[L_5]]
// CHECK-NEXT: v14 = Convert v13 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v14 layout=[[L_2]]
// CHECK-NEXT: v16 = Convert v13 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = CallDirect v2, v0, v14, v4, v16 function=[[f_11]]
// CHECK-NEXT: v18 = Convert v13 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="T"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_14]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_15]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=env [[L_3]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[f_16]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: env [[L_3]], v2: anything, v3: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="C"
// CHECK-NEXT: v6 = StrictEq v5, v3
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b9()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = GetEnvironmentField v1 layout=[[L_3]] field=2
// CHECK-NEXT: v8 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Increment v11
// CHECK-NEXT: v13 = StrictEq v5, v3
// CHECK-NEXT: Branch v13 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = GetEnvironmentField v1 layout=[[L_3]] field=2
// CHECK-NEXT: v15 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v17
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: v19 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v19 layout=[[L_3]] field=2
// CHECK-NEXT: v21 = NewClosure v0, v1, v2, v3 function=[[f_17]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_16]] flags=[IsExpected]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: b8() frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b9() frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagOnThis"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v3, v0
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = NewTemplateObject templateStrings=[{cooked="a" raw="a"}]
// CHECK-NEXT: v6 = Call v1, v3, v5 calleeName="this.#m"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v7
// CHECK-NEXT: }
