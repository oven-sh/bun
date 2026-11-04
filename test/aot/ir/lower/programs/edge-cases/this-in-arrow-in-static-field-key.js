// RUN: lower
// OPTIONS: builtin-modules

// `this` in an arrow function in the computed key of a static field is that of the code around the class.
class A { static [console.log((() => this)() == null)] = 1; }
export {};

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = NewClosure function=[[f_4]]
// CHECK-NEXT: v9 = Call v8
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: v11 = Call v7, v5, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = ToPropertyKey v11
// CHECK-NEXT: v13 = String string="prototype"
// CHECK-NEXT: v14 = StrictEq v12, v13
// CHECK-NEXT: Branch v14 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=StaticPrototypeKey
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b2():
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_5]]
// CHECK-NEXT: v17 = FinishClass v1 layout=[[L_2]]
// CHECK-NEXT: v18 = Convert v17 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v19 = Convert v17 declared={type=function flags=[IsFromCompiler]}
// CHECK-NEXT: v20 = CallDirect v19 function=[[f_6]]
// CHECK-NEXT: v21 = Convert v17 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Null
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} kind=Initializer flags=[HasThis, IsHiddenInStackTraces] thisType={type=function flags=[IsFromCompiler]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: ElemDefine v1, v2, v3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
