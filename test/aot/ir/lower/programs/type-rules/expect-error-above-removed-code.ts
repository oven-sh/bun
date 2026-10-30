// RUN: lower
// OPTIONS: builtin-modules

// A `@ts-expect-error` directly above code that folding removes is not reported as unused: the error it expects is in code that is not checked.
// @ts-expect-error
if (false) missing();
const kept = false &&
  // @ts-expect-error
  missing();
console.log("printed", kept);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false site=[[w_1]]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="printed"
// CHECK-NEXT: v8 = Call v6, v4, v7, v1 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
