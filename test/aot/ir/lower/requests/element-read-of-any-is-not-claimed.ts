// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: site=
// CHECK-NOT: Convert
// CHECK: [[element]] = ElemGet [[receiver]],
// CHECK-NEXT: Return [[element]]

export function f(a: any) {
  return a[0];
}
