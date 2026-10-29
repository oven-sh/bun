// RUN: lower
// OPTIONS: builtin-modules

// Classic JSX runtime: a fragment with an `@jsxFrag` pragma.
/** @jsxRuntime classic */ /** @jsx h */ /** @jsxFrag F */
const F = "fragment"; const h = (t) => t;
console.log((() => <></>)());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="fragment"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"fragment" flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_1]]
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_4]]
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure function=[[f_5]]
// CHECK-NEXT: v12 = Call v11
// CHECK-NEXT: v13 = Call v10, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="h"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="F"
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = Call v1, -, v3, v4 calleeName="h"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
