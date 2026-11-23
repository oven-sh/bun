// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[parameter]]: anything):
// CHECK: [[closure]] = NewClosure function=
// CHECK-NOT: Return [[parameter]]
// CHECK: Return [[closure]]

export function f(a) {
  function a() {}
  return a;
}
