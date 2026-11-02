// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: site=
// CHECK: [[receiver]] = Convert {{*}}declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK: [[element]] = ElemGet [[receiver]],
// CHECK-NEXT: Return [[element]]

export function f(a: any) {
  return a[0];
}
