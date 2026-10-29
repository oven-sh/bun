// RUN: lower
// OPTIONS: builtin-modules

// Static private fields and initializers that throw: which members exist afterwards, and that methods and accessors exist from the start.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

let leaked: any;
row("the initializer between throws", () => {
  class C {
    static has() { return [#a in C, #b in C].join(); }
    static readA() { return C.#a; }
    static readB() { return C.#b; }
    static writeB() { C.#b = 2; return "stored"; }
    static #a = 1;
    static { leaked = C; }
    static boom = (() => { throw new RangeError("boom"); })();
    static #b = 1;
  }
  return C;
});
for (const door of ["has", "readA", "readB", "writeB", "has"]) row("behind the throw " + door, () => leaked[door]());
let topLeaked: any;
try {
  class T {
    static has() { return [#a in T, #b in T, #m in T].join(); }
    static readB() { return T.#b; }
    static writeB() { T.#b = 2; return "stored"; }
    static m() { return T.#m === T.#m; }
    static #m() {}
    static #a = 1;
    static { topLeaked = T; throw new RangeError("boom"); }
    static #b = 1;
  }
} catch (e) { console.log("top level: " + (e as Error).name); }
for (const door of ["has", "readB", "writeB", "has", "m"]) row("top level behind the throw " + door, () => topLeaked[door]());
class Blank { static #u: unknown; static { row("without an initializer", () => [#u in Blank, Blank.#u].join()); } }
class Chain { static #a = 1; static #b = Chain.#a + 1; static #c = Chain.#b + Chain.#a; static { row("one after the other", () => [Chain.#a, Chain.#b, Chain.#c].join()); } }
class Later {
  static peek = () => Later.#v;
  static poke = (v: number) => { Later.#v = v; };
  static first = said(Later.peek) + " " + said(() => Later.poke(3));
  static #v = 1;
  static second = said(Later.peek) + " " + said(() => Later.poke(3)) + " " + said(Later.peek);
}
console.log("a closure made early: " + Later.first + " | " + Later.second);
const rounds: string[] = [];
for (let i = 0; i < 3; i++) {
  class L {
    static has() { return #v in L; }
    static { rounds.push(String(L.has())); }
    static #v = i;
    static { rounds.push(String(L.has()) + L.#v); }
  }
}
console.log("each evaluation starts without: " + rounds.join());
class Self { static #me: unknown = said(() => Self.#me); static { row("its own initializer reads it", () => Self.#me); } }
class Methods { static { row("methods and accessors are there from the start", () => [#m in Methods, #g in Methods, #s in Methods, typeof Methods.#m, Methods.#g].join()); } static #m() {} static get #g() { return 1; } static set #s(v: number) {} }

// GENERATED: said #g #s C readA poke
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#s"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readA"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: env [[L_10]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="C"
// CHECK-NEXT: v4 = StrictEq v3, v1
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_10]] field=1
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="poke"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_12]]}] results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Later"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v0 declared={type=number site=[[w_17]]}
// CHECK-NEXT: PutModuleVariable v10 variable=[[g_16]]
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
