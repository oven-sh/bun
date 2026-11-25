// RUN: lower
// OPTIONS: builtin-modules

// Static private fields in every kind of expression: unary, binary, `++`, compound and logical assignments, BigInts, chained stores.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    static #n = n;
    static #big = 10n;
    static #s = "s" + n;
    static #flag = false;
    static #list = [n, n + 1];
    static #o = { v: n, who(this: unknown) { return this === C.#o; }, tag(this: unknown, s: TemplateStringsArray) { return (this === C.#o) + s[0]; }, deep: { w: n } as { w: number } | undefined };
    static #K = class Inner { v = n; };
    static #key = "k" + n;
    static #p = Promise.resolve(n);
    static #a = 1;
    static #b = 2;
    static *#g() { yield n; yield n + 1; }
    static rows(label: string) {
      const t = (what: string, f: () => unknown) => row(label + " " + what, f);
      t("unary", () => [-C.#n, +C.#n, ~C.#n, !C.#flag, typeof C.#n, void C.#n].join());
      t("binary", () => [C.#n + 1, C.#n * 2, C.#n ** 2, C.#n < 3, C.#n === n, C.#s + C.#n, `${C.#s}!`].join());
      t("post and pre", () => [C.#n++, C.#n, ++C.#n, C.#n--, --C.#n, C.#n].join());
      t("a bigint", () => [String(C.#big++), String(++C.#big), String(C.#big -= 2n)].join());
      t("compound", () => [C.#n += 2, C.#n -= 2, C.#n *= 3, C.#n /= 3, C.#n %= 100, C.#n <<= 1, C.#n >>= 1, C.#n |= 0, C.#n &= 255, C.#n ^= 0, C.#n **= 1, C.#s += "x"].join());
      t("logical", () => [C.#flag ||= true, C.#flag &&= false, C.#n ??= 9].join());
      t("a chain of stores", () => { C.#a = C.#b = 3; return [C.#a, C.#b].join(); });
      t("a swap", () => { C.#a = 1; C.#b = 2; [C.#a, C.#b] = [C.#b, C.#a]; return [C.#a, C.#b].join(); });
      t("an object pattern", () => { ({ x: C.#a, y: C.#b = 7 } = { x: 5 } as { x: number, y?: number }); return [C.#a, C.#b].join(); });
      t("the value of a store", () => (C.#a = 4) + 1);
      t("a member of it", () => [C.#o.v, C.#o["v"], C.#o.deep?.w, C.#list[1], C.#list.length, C.#o.who(), C.#o.tag`x`].join());
      t("a store below it", () => { C.#o.v = 8; C.#o.v++; C.#list[0] += 5; C.#list.push(1); return [C.#o.v, C.#list.join("")].join(); });
      t("spread", () => [[...C.#list].length, Object.keys({ ...C.#o }).length, Math.max(...C.#list)].join());
      t("for of", () => { let s = 0; for (const x of C.#list) s += x; for (const x of C.#g()) s += x; return s; });
      t("for in", () => { let s = ""; for (const k in C.#o) s += k; return s; });
      t("a computed key", () => Object.keys({ [C.#key]: 1 })[0] + ({ k1: "one", k2: "two" } as Record<string, string>)[C.#key]);
      t("new and instanceof", () => [new C.#K().v, new C.#K() instanceof C.#K, class extends C.#K {}.name.length].join());
      t("switch", () => { switch (C.#key) { case "k1": return "one"; case "k2": return "two"; default: return "none"; } });
      t("conditional", () => [C.#flag ? C.#a : C.#b, C.#n && C.#a, C.#flag || C.#b].join());
      t("an argument", () => Math.min(C.#a, C.#b) + [C.#a].concat(C.#b).join(""));
      t("yield", () => [...(function* () { yield C.#a; yield* C.#g(); })()].join());
      t("a closure keeps the class, not the value", () => { const f = () => C.#a; C.#a = 40; return f(); });
    }
    static async later(label: string) { console.log(label + " await: " + (await C.#p) + " " + (await C.#n)); }
  };
}
const A = make(1), B = make(2);
A.rows("first"); B.rows("second"); A.rows("first again");
A.later("first").then(() => B.later("second"));

// GENERATED: make C #g tag
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = NewObject layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_4]]
// CHECK-NEXT: PutEnvironmentField v2, v4 layout=[[L_2]]
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v7 = NewClosure v1, v2, v0, v6 function=[[f_6]]
// CHECK-NEXT: DefineMethod v4, v7 layout=[[L_4]] side=Static key="rows"
// CHECK-NEXT: v9 = NewClosure v1, v2 function=[[f_7]]
// CHECK-NEXT: DefineMethod v4, v9 layout=[[L_4]] side=Static index=1 key="later"
// CHECK-NEXT: v11 = FinishClass v4 layout=[[L_4]]
// CHECK-NEXT: v12 = Convert v11 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: PutEnvironmentField v1, v12 layout=[[L_1]]
// CHECK-NEXT: v14 = Convert v11 declared={type=function flags=[IsFromCompiler]}
// CHECK-NEXT: v15 = CallDirect v2, v0, v12, v14 function=[[f_8]]
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] captures=[{type=number variableName="n"}] thisType={type=function flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number, v1: function, v2: function):
// CHECK-NEXT: InitialYield v1
// CHECK-NEXT: v4 = Yield v0, v1
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Switch v6 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Yield v8, v1
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 captures=[{type=env [[L_2]] flags=[IsFromCompiler]}, {type=[[f_3]] flags=[IsFromCompiler] variableName="C"}] thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: [[f_3]], v2: anything, v3: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v5 = StrictEq v1, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b4()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_2]] field=6
// CHECK-NEXT: v7 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = StrictEq v2, v10
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = ElemGet v3, v12
// CHECK-NEXT: v14 = Add v11, v13
// CHECK-NEXT: Return v14
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v15 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = PropGet v16 key="#o"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v19
// CHECK-NEXT: }
