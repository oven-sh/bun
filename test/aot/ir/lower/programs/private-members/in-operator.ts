// RUN: lower
// OPTIONS: builtin-modules

// `#name in object`: the right-hand side is evaluated once, non-objects throw, and the result narrows.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    static #field = n;
    static #blank: unknown;
    static #method() { return n; }
    static get #getter() { return n; }
    static set #setter(v: number) {}
    static get #both() { return n; }
    static set #both(v: number) {}
    #instance = n;
    static asks: [string, (v: any) => boolean][] = [];
    static {
      C.asks = [["field", v => #field in v], ["blank", v => #blank in v], ["method", v => #method in v], ["getter", v => #getter in v], ["setter", v => #setter in v], ["both", v => #both in v], ["instance", v => #instance in v]];
    }
    static once(f: () => any) { return #field in f(); }
    static inCondition(v: any) { if (#method in v) return "yes"; else return "no"; }
    static negated(v: any) { return !(#method in v); }
    static inLoop(vs: any[]) { let n = 0; for (const v of vs) if (#field in v) n++; return n; }
    static caught(v: any) { try { return #field in v; } catch (e) { return "caught " + (e as Error).name; } finally { C.finals++; } }
    static finals = 0;
    static narrowed(v: unknown) { return typeof v === "function" && #field in v ? v.#field : -1; }
    static both(v: any) { return #field in v && #method in v; }
  };
}
const A = make(1), B = make(2);
class H extends A {}
const values: [string, any][] = [["the class", A], ["another evaluation", B], ["an heir", H], ["an instance", new A()], ["an object below", Object.create(A)], ["a proxy", new Proxy(A, {})], ["a function", () => 1], ["an object", {}], ["an array", []],
  ["null", null], ["undefined", undefined], ["a number", 1], ["zero", 0], ["NaN", NaN], ["a string", "s"], ["the empty string", ""], ["true", true], ["false", false], ["a symbol", Symbol()], ["a bigint", 1n]];
for (const [kind, ask] of A.asks) for (const [name, v] of values) row(kind + " in " + name, () => ask(v));
let evaluated = 0;
row("the right side once", () => A.once(() => { evaluated++; return A; }) + " " + evaluated);
row("the right side once, then thrown", () => { try { A.once(() => { evaluated++; return 1; }); } catch (e) { return (e as Error).name + " " + evaluated; } });
for (const [name, v] of values) {
  row("in a condition: " + name, () => A.inCondition(v));
  row("negated: " + name, () => A.negated(v));
  row("caught: " + name, () => A.caught(v) + " " + A.finals);
  row("narrowed: " + name, () => A.narrowed(v));
  row("both: " + name, () => A.both(v));
}
row("in a loop", () => A.inLoop([A, B, H, {}, A]));
row("in a loop that throws", () => A.inLoop([A, 1, A]));
class T { static #s = 1; static #m() {} static has(v: any) { return [#s in v, #m in v].join(); } }
for (const [name, v] of [["the top-level class", T] as [string, any], ...values]) row("top level: " + name, () => T.has(v));

// GENERATED: make H C once negated
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject layout=[[L_5]]
// CHECK-NEXT: v3 = NewClassToken layout=[[L_6]]
// CHECK-NEXT: v4 = NewClosure v0, v3 function=[[f_7]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_6]]
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_8]]
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v8 = NewClosure function=[[f_10]]
// CHECK-NEXT: v9 = NewClosure v0 function=[[f_11]]
// CHECK-NEXT: v10 = NewClosure function=[[f_12]]
// CHECK-NEXT: v11 = NewClosure v2, v5 function=[[f_13]]
// CHECK-NEXT: DefineMethod v5, v11 layout=[[L_6]] side=Static key="once"
// CHECK-NEXT: v13 = NewClosure v5, v6 function=[[f_14]]
// CHECK-NEXT: DefineMethod v5, v13 layout=[[L_6]] side=Static index=1 key="inCondition"
// CHECK-NEXT: v15 = NewClosure v5, v6 function=[[f_15]]
// CHECK-NEXT: DefineMethod v5, v15 layout=[[L_6]] side=Static index=2 key="negated"
// CHECK-NEXT: v17 = NewClosure v2, v5 function=[[f_16]]
// CHECK-NEXT: DefineMethod v5, v17 layout=[[L_6]] side=Static index=3 key="inLoop"
// CHECK-NEXT: v19 = NewClosure v1, v2, v5 function=[[f_17]]
// CHECK-NEXT: DefineMethod v5, v19 layout=[[L_6]] side=Static index=4 key="caught"
// CHECK-NEXT: v21 = NewClosure v2, v5 function=[[f_18]]
// CHECK-NEXT: DefineMethod v5, v21 layout=[[L_6]] side=Static index=5 key="narrowed"
// CHECK-NEXT: v23 = NewClosure v2, v5, v6 function=[[f_19]]
// CHECK-NEXT: DefineMethod v5, v23 layout=[[L_6]] side=Static index=6 key="both"
// CHECK-NEXT: v25 = FinishClass v5 layout=[[L_6]]
// CHECK-NEXT: v26 = Convert v25 declared={type=[[f_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v26 layout=[[L_4]]
// CHECK-NEXT: v28 = Convert v25 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v29 = CallDirect v2, v0, v26, v5, v3, v6, v7, v8, v9, v10, v28 function=[[f_20]]
// CHECK-NEXT: v30 = Convert v25 declared={type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="H"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_22]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_22]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=number site=[[w_1]]}, {type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: number, v1: classtoken, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v2 layout=[[L_6]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v0, v1, v5 function=[[f_23]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_26]]}] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: function, v2: undefined|null|[[f_24]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Call v2 calleeName="f"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = TypeTest v4 testedType=object
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = StrictEq v6, v1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4(v7)
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v9 = TypeTest v8 testedType=absent
// CHECK-NEXT: v10 = LogicalNot v9
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean site=[[w_26]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b5(v13) frequency=Unlikely:
// CHECK-NEXT: v14 = PropHas v13 key="#field"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="negated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=function flags=[IsFromCompiler]}, {type=anything}] thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_27]]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = RequireObject v3 runtimeError=PrivateStaticTestOfNonObject
// CHECK-NEXT: v5 = StrictEq v4, v0
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: v7 = LogicalNot v6
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_27]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
