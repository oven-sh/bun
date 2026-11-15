// RUN: lower
// CHECK-LABEL: function {{*}}name="stored"
// CHECK: Branch {{*}}-> taken [[taken]](
// CHECK: [[taken]](
// CHECK: [[environment]] = NewObject {{*}}layout=[[block]]
// CHECK: [[closure]] = NewClosure [[environment]] function=
// CHECK: PutEnvironmentField [[environment]], [[closure]] layout=[[block]]
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NEXT: b0([[captured]]: env
// CHECK: PutEnvironmentField [[captured]],
// CHECK: = GetEnvironmentField [[captured]]
// CHECK: Return

// RUN(EXPRESSION): lower
// EXPRESSION-LABEL: function {{*}}name="named"
// EXPRESSION-NOT: EnvironmentField
// EXPRESSION: Return

function stored(a) {
  if (a) function f() { f = 1; return f; }
  return f;
}
exports.stored = stored;
exports.expression = function named() { named = 1; return named; };
