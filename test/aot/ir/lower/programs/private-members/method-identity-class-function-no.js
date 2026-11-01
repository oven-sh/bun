// RUN: lower
// OPTIONS: builtin-modules

// A private method is the same function object every time it is read: the class is declared in a function and captures nothing (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label, A, B) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
function make(n) { class P {
    static #m() { return 7; }
    static async #a() { return 7; }
    static *#g() { yield 7; }
    static async *#ag() { yield 7; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s, f) => f)`${P.#m}`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P?.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
} return P; }
check("n", make(1), make(2));

// GENERATED: #ag viaInner viaTemplate viaLiteralGetter X
// CHECK-LABEL: function {{*}}name="#ag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=7
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaInner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_5]]
// CHECK-NEXT: v5 = NewClosure v0, v1, v2 function=[[f_6]]
// CHECK-NEXT: DefineMethod v4, v5 layout=[[L_5]] side=Static key="q"
// CHECK-NEXT: v7 = FinishClass v4 layout=[[L_5]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = PropGet v7 key="q"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v7 calleeKey="q" calleeName="q"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|[[f_3]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaTemplate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewClosure function=[[f_8]]
// CHECK-NEXT: v4 = NewTemplateObject templateStrings=[{cooked="" raw=""}, {cooked="" raw=""}]
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="P"
// CHECK-NEXT: v7 = StrictEq v6, v1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v3, -, v4, v8
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaLiteralGetter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} results=[{type=undefined|null|[[f_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject layout=[[L_9]]
// CHECK-NEXT: v4 = NewClosure v0, v1, v2 function=[[f_10]]
// CHECK-NEXT: DefineGetter v3, v4 key="g"
// CHECK-NEXT: v6 = FinishObject v3
// CHECK-NEXT: v7 = PropGet v6 key="g"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="X"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="X"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="X"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
