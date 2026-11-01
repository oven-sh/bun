// RUN: lower
// OPTIONS: builtin-modules

// A class expression that names itself stands in the computed key of a method.
class B { [(class K { g() { K; } }).name]() {} }
console.log("K" in B.prototype);

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
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_5]]
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_6]]
// CHECK-NEXT: v6 = NewClosure function=[[f_7]]
// CHECK-NEXT: DefineMethod v4, v6 layout=[[L_5]] key="g"
// CHECK-NEXT: v8 = FinishClass v4 layout=[[L_5]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_8]]
// CHECK-NEXT: v11 = PropGet v8 key="name"
// CHECK-NEXT: v12 = ToPropertyKey v11
// CHECK-NEXT: v13 = NewClosure function=[[f_9]]
// CHECK-NEXT: SetFunctionName v13, v12
// CHECK-NEXT: DefineMethod v1, v13, v12 layout=[[L_2]]
// CHECK-NEXT: v16 = FinishClass v1 layout=[[L_2]]
// CHECK-NEXT: v17 = Convert v16 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = Convert v16 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v18 key="prototype"
// CHECK-NEXT: v25 = PropHas v24 key="K"
// CHECK-NEXT: v26 = Call v23, v21, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="K"
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
