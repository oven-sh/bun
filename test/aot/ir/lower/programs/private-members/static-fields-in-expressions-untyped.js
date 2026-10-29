// RUN: lower
// OPTIONS: builtin-modules

// Static private fields in every kind of expression: unary, binary, `++`, compound and logical assignments, BigInts, chained stores (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function make(n) {
  return class C {
    static #n = n;
    static #big = 10n;
    static #s = "s" + n;
    static #flag = false;
    static #list = [n, n + 1];
    static #o = { v: n, who() { return this === C.#o; }, tag(s) { return (this === C.#o) + s[0]; }, deep: { w: n } };
    static #K = class Inner { v = n; };
    static #key = "k" + n;
    static #p = Promise.resolve(n);
    static #a = 1;
    static #b = 2;
    static *#g() { yield n; yield n + 1; }
    static rows(label) {
      const t = (what, f) => row(label + " " + what, f);
      t("unary", () => [-C.#n, +C.#n, ~C.#n, !C.#flag, typeof C.#n, void C.#n].join());
      t("binary", () => [C.#n + 1, C.#n * 2, C.#n ** 2, C.#n < 3, C.#n === n, C.#s + C.#n, `${C.#s}!`].join());
      t("post and pre", () => [C.#n++, C.#n, ++C.#n, C.#n--, --C.#n, C.#n].join());
      t("a bigint", () => [String(C.#big++), String(++C.#big), String(C.#big -= 2n)].join());
      t("compound", () => [C.#n += 2, C.#n -= 2, C.#n *= 3, C.#n /= 3, C.#n %= 100, C.#n <<= 1, C.#n >>= 1, C.#n |= 0, C.#n &= 255, C.#n ^= 0, C.#n **= 1, C.#s += "x"].join());
      t("logical", () => [C.#flag ||= true, C.#flag &&= false, C.#n ??= 9].join());
      t("a chain of stores", () => { C.#a = C.#b = 3; return [C.#a, C.#b].join(); });
      t("a swap", () => { C.#a = 1; C.#b = 2; [C.#a, C.#b] = [C.#b, C.#a]; return [C.#a, C.#b].join(); });
      t("an object pattern", () => { ({ x: C.#a, y: C.#b = 7 } = { x: 5 }); return [C.#a, C.#b].join(); });
      t("the value of a store", () => (C.#a = 4) + 1);
      t("a member of it", () => [C.#o.v, C.#o["v"], C.#o.deep?.w, C.#list[1], C.#list.length, C.#o.who(), C.#o.tag`x`].join());
      t("a store below it", () => { C.#o.v = 8; C.#o.v++; C.#list[0] += 5; C.#list.push(1); return [C.#o.v, C.#list.join("")].join(); });
      t("delete below it", () => { delete C.#o.deep; return "deep" in C.#o; });
      t("spread", () => [[...C.#list].length, Object.keys({ ...C.#o }).length, Math.max(...C.#list)].join());
      t("for of", () => { let s = 0; for (const x of C.#list) s += x; for (const x of C.#g()) s += x; return s; });
      t("for in", () => { let s = ""; for (const k in C.#o) s += k; return s; });
      t("a computed key", () => Object.keys({ [C.#key]: 1 })[0] + ({ k1: "one", k2: "two" })[C.#key]);
      t("new and instanceof", () => [new C.#K().v, new C.#K() instanceof C.#K, class extends C.#K {}.name.length].join());
      t("switch", () => { switch (C.#key) { case "k1": return "one"; case "k2": return "two"; default: return "none"; } });
      t("conditional", () => [C.#flag ? C.#a : C.#b, C.#n && C.#a, C.#flag || C.#b].join());
      t("an argument", () => Math.min(C.#a, C.#b) + [C.#a].concat(C.#b).join(""));
      t("yield", () => [...(function* () { yield C.#a; yield* C.#g(); })()].join());
      t("a closure keeps the class, not the value", () => { const f = () => C.#a; C.#a = 40; return f(); });
    }
    static async later(label) { console.log(label + " await: " + (await C.#p) + " " + (await C.#n)); }
  };
}
const A = make(1), B = make(2);
A.rows("first"); B.rows("second"); A.rows("first again");
A.later("first").then(() => B.later("second"));

// GENERATED: make C #g t tag
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject layout=[[L_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_5]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v6 = NewClosure v1, v2, v0, v4, v5 function=[[f_7]]
// CHECK-NEXT: DefineMethod v4, v6 layout=[[L_5]] side=Static key="rows"
// CHECK-NEXT: v8 = NewClosure v1, v2, v4 function=[[f_8]]
// CHECK-NEXT: DefineMethod v4, v8 layout=[[L_5]] side=Static index=1 key="later"
// CHECK-NEXT: v10 = FinishClass v4 layout=[[L_5]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v11 layout=[[L_2]]
// CHECK-NEXT: v13 = Convert v10 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = CallDirect v2, v0, v11, v4, v13 function=[[f_9]]
// CHECK-NEXT: v15 = Convert v10 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=anything}] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Add v4, v8
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="t"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 captures=[{type=anything}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v4 = String string=" "
// CHECK-NEXT: v5 = Add v0, v4
// CHECK-NEXT: v6 = Add v5, v1
// CHECK-NEXT: v7 = Call v3, -, v6, v2 calleeName="row"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 captures=[{type=env [[L_3]] flags=[IsFromCompiler]}, {type=[[f_4]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: [[f_4]], v2: function, v3: anything, v4: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = Convert v3 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v6 = StrictEq v1, v2
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_3]] field=5
// CHECK-NEXT: v8 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: v13 = StrictEq v5, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = ElemGet v4, v14
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: Return v16
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v17
// CHECK-NEXT: }
