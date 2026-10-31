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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="level"
// CHECK-NEXT: v8 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewClosure function=[[f_2]]
// CHECK-NEXT: v10 = NewArray v9 contents=undefined|null|[[f_3]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|[[f_3]]> flags=[IsExpected]}
// CHECK-NEXT: PropSet v8, v11 key="hooks"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v14 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="level"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
