// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[y]]: undefined|null|string):
// CHECK-NOT: site=
// CHECK: [[expected]] = Convert [[y]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Call {{*}}, [[expected]] calleeName="g"
// CHECK-NOT: Convert
// CHECK: Return
// CHECK-LABEL: function {{*}}name="g"
// CHECK: parameters=[{type=number site=w

function g(x: number) {}

export function f(y: string) {
  g(y as any);
}
