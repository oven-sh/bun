// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}parameters=[{type=undefined|null|L{{*}}}]
// CHECK: b0([[parameter]]: undefined|null|L{{*}}):
// CHECK-NOT: Convert [[parameter]]
// CHECK: [[b]] = PropGet [[object]] key="b"
// CHECK-NEXT: Return [[b]]

export function f({ b }: { b: number }) {
  return b;
}
