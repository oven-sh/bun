// RUN: lower
// OPTIONS: builtin-modules

// Private accessors: reading one that has only a setter and writing one that has only a getter throw, in every kind of expression (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function make(n) {
  return class C {
    static log = [];
    static #kept = n;
    static set #w(v) { C.log.push("set " + v + " " + (this === C)); C.#kept = v; }
    static get #r() { C.log.push("get " + (this === C)); return C.#kept; }
    static get #rw() { C.log.push("get"); return C.#kept; }
    static set #rw(v) { C.log.push("set " + v); C.#kept = v; }
    static rows(label) {
      const t = (what, f) => { C.log.length = 0; const r = said(f); console.log(label + " " + what + ": " + r + " [" + C.log.join() + "] " + C.#kept); };
      t("read of a setter alone", () => (C).#w);
      t("read of a setter alone on this", () => C.readOnThis());
      t("typeof a setter alone", () => typeof (C).#w);
      t("a setter alone called", () => (C).#w());
      t("a setter alone as a tag", () => (C).#w`a`);
      t("a setter alone, chained", () => C?.#w);
      t("a setter alone +=", () => (C).#w += 1);
      t("a setter alone ++", () => (C).#w++);
      t("a setter alone ??=", () => (C).#w ??= 5);
      t("a setter alone ||=", () => (C).#w ||= 5);
      t("a setter alone &&=", () => (C).#w &&= 5);
      t("a setter alone =", () => C.#w = 4);
      t("a setter alone in a pattern", () => { [C.#w] = [8]; });
      t("a setter alone in", () => #w in C);
      t("a getter alone read", () => C.#r);
      t("a getter alone =", () => (C).#r = 4);
      t("a getter alone +=", () => (C).#r += 1);
      t("a getter alone ++", () => (C).#r++);
      t("a getter alone ||=", () => (C).#r ||= 5);
      t("a getter alone &&=", () => (C).#r &&= 5);
      t("a getter alone ??=", () => (C).#r ??= 5);
      t("a getter alone in a pattern", () => { [(C).#r] = [8]; });
      t("both read", () => C.#rw);
      t("both =", () => C.#rw = 6);
      t("both +=", () => C.#rw += 1);
      t("both ++", () => C.#rw++);
      t("both prefix --", () => --C.#rw);
      t("both ||=", () => C.#rw ||= 5);
      t("both &&=", () => C.#rw &&= 5);
      t("both ??=", () => C.#rw ??= 5);
    }
    static readOnThis() { return (this).#w; }
  };
}
make(1).rows("first");
make(20).rows("second");
class T {
  static set #w(v) {}
  static get #r() { return 1; }
  static #m() {}
  static {
    row("top read of a setter alone", () => (T).#w);
    row("top a setter alone +=", () => (T).#w += 1);
    row("top a getter alone =", () => (T).#r = 1);
    row("top a method =", () => (T).#m = 1);
    row("top a method +=", () => (T).#m += 1);
    row("top a method ++", () => (T).#m++);
    row("top a method ||=", () => typeof ((T).#m ||= 1));
    row("top a method &&=", () => (T).#m &&= 1);
    row("top a method in a pattern", () => { [(T).#m] = [1]; });
  }
}

// GENERATED: make T #r readOnThis
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject layout=[[L_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_5]]
// CHECK-NEXT: v5 = NewClosure v1, v2, v4 function=[[f_6]]
// CHECK-NEXT: v6 = NewClosure v1, v2, v4 function=[[f_7]]
// CHECK-NEXT: v7 = NewClosure v1, v2, v4 function=[[f_8]]
// CHECK-NEXT: v8 = NewClosure v1, v2, v4 function=[[f_9]]
// CHECK-NEXT: v9 = NewClosure v1, v2, v4, v5, v6, v7, v8 function=[[f_10]]
// CHECK-NEXT: DefineMethod v4, v9 layout=[[L_5]] side=Static key="rows"
// CHECK-NEXT: v11 = NewClosure v4, v5 function=[[f_11]]
// CHECK-NEXT: DefineMethod v4, v11 layout=[[L_5]] side=Static index=1 key="readOnThis"
// CHECK-NEXT: v13 = FinishClass v4 layout=[[L_5]]
// CHECK-NEXT: v14 = Convert v13 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v14 layout=[[L_2]]
// CHECK-NEXT: v16 = Convert v13 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = CallDirect v2, v0, v4, v16 function=[[f_12]]
// CHECK-NEXT: v18 = Convert v13 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="T"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#r"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#r"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=env [[L_3]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}] thisType={type=function flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: env [[L_3]], v2: function, v3: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="C"
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="push"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="get "
// CHECK-NEXT: v11 = Convert v3 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v12 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="C"
// CHECK-NEXT: v14 = StrictEq v11, v13
// CHECK-NEXT: v15 = Add v10, v14
// CHECK-NEXT: v16 = Call v9, v7, v15 calleeKey="push" calleeName="C.log.push"
// CHECK-NEXT: v17 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="C"
// CHECK-NEXT: v19 = StrictEq v18, v2
// CHECK-NEXT: Branch v19 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v20 = GetEnvironmentField v1 layout=[[L_3]]
// CHECK-NEXT: v21 = TypeTest v20 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b4(v24):
// CHECK-NEXT: Return v24
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readOnThis"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=function flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v3, v0
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=PrivateAccessorWithoutGetter
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v6 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v6
// CHECK-NEXT: }
