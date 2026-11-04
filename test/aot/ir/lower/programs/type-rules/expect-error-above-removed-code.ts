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
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="printed"
// CHECK-NEXT: v7 = Call v5, v3, v6, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
