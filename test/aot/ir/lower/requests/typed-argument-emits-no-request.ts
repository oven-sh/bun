// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[y]]: undefined|null|string):
// CHECK-NOT: Convert
// CHECK: = Call {{*}}, [[y]] calleeName="g"
// CHECK-NOT: Convert
// CHECK: Return
// CHECK-LABEL: function {{*}}name="g"
// CHECK: parameters=[{type=number

// An argument is converted to nothing, not even to what the callee expects: the callee tests its parameter.
function g(x: number) {}

export function f(y: string) {
  g(y as any);
}
