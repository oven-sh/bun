// RUN: lower
// OPTIONS: builtin-modules

// A static generator or accessor named `constructor` is valid JavaScript. TypeScript's errors (1368, 1341) are its own there: below a `@ts-ignore` the program builds and runs as in plain Bun.
class A {
  // @ts-ignore
  static *constructor() { yield 1; }
}
class B {
  // @ts-ignore
  static get constructor() { return 2; }
}
console.log([...A.constructor()], B.constructor);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v3 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineMethod v1, v3 layout=[[L_2]] side=Static key="constructor"
// CHECK-NEXT: v5 = FinishClass v1 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = Convert v5 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = NewClosure function=[[f_5]]
// CHECK-NEXT: v9 = NewClass v8 layout=[[L_6]]
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_7]]
// CHECK-NEXT: v11 = NewClosure function=[[f_8]]
// CHECK-NEXT: DefineMethod v9, v11 layout=[[L_6]] side=Static methodKind=Getter key="constructor"
// CHECK-NEXT: v13 = FinishClass v9 layout=[[L_6]]
// CHECK-NEXT: v14 = Convert v13 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Convert v13 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = NewArray contents=anything
// CHECK-NEXT: v22 = PropGet v7 key="constructor"
// CHECK-NEXT: v23 = Call v22, v7 calleeKey="constructor" calleeName="A.constructor"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: AppendSpread v21, v24
// CHECK-NEXT: v26 = PropGet v15 key="constructor"
// CHECK-NEXT: v27 = Convert v26 declared={type=number site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = Call v20, v18, v21, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: function, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="constructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
