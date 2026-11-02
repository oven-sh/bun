// RUN: lower
// OPTIONS: builtin-modules

// `this` in an arrow function in the computed key of a static field is that of the code around the class.
class A { static [console.log((() => this)() == null)] = 1; }
export {};

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined|null
// CHECK-NEXT: v12 = Call v7, v5, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = ToPropertyKey v12
// CHECK-NEXT: v14 = String string="prototype"
// CHECK-NEXT: v15 = StrictEq v13, v14
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2() frequency=Unlikely:
// CHECK-NEXT: v16 = NewRuntimeError runtimeError=StaticPrototypeKey
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b3():
// CHECK-NEXT: PutModuleVariable v13 variable=[[g_6]]
// CHECK-NEXT: v18 = FinishClass v1 layout=[[L_2]]
// CHECK-NEXT: v19 = Convert v18 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v20 = Convert v18 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v21 = CallDirect v20 function=[[f_7]]
// CHECK-NEXT: v22 = Convert v18 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[f_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} kind=Initializer flags=[HasThis, IsHiddenInStackTraces] thisType={type=function flags=[IsFromCompiler]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: ElemDefine v1, v2, v3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
