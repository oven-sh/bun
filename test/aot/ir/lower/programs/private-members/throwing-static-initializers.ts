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
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#g"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#s"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=OmittedFromExecutable name="#s"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readA"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}, {type=[[f_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: [[f_4]]):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="C"
// CHECK-NEXT: v4 = StrictEq v3, v1
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b4()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_3]] field=1
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = PropGet v11 key="#a"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="poke"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Later"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b4()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_7]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v12 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = PropGet v13 key="#v"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = NewRuntimeError runtimeError=InvalidPrivateWrite
// CHECK-NEXT: Throw v16
// CHECK-NEXT: }
