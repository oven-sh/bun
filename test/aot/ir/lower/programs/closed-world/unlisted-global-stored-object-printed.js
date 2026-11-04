// RUN: lower
// OPTIONS: builtin-modules

// Unlisted global stored object is printed and copied.
class Config { constructor() { this.level = 3; this.hooks = [() => "a hook"]; } get doubled() { return this.level * 2; } }
globalThis.__printedAndCopied = new Config();
console.log(globalThis.__printedAndCopied, JSON.stringify(globalThis.__printedAndCopied), structuredClone({ level: globalThis.__printedAndCopied.level }));
console.log(Object.assign({}, globalThis).__printedAndCopied.hooks[0](), { ...globalThis }.__printedAndCopied.doubled);

// GENERATED: Config doubled
// CHECK-LABEL: function {{*}}name="Config"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: PropSet v3, v4 key="level"
// CHECK-NEXT: v6 = NewClosure function=[[f_2]]
// CHECK-NEXT: v7 = NewArray v6 contents=anything
// CHECK-NEXT: PropSet v3, v7 key="hooks"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="level"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
