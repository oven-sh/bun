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
// CHECK-NEXT: v0 = String string="fragment"
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_1]]
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = NewClosure function=[[f_4]]
// CHECK-NEXT: v10 = Call v9
// CHECK-NEXT: v11 = Call v8, v6, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="h"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="F"
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = Call v1, -, v3, v4 calleeName="h"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
