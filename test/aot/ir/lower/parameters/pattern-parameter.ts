// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}parameters=[{type=undefined|null|L{{*}} site=w{{*}}}]
// CHECK: b0([[parameter]]: undefined|null|L{{*}}):
// CHECK-NOT: Convert [[parameter]]
// CHECK: [[read]] = PropGet [[object]] key="b"
// CHECK-NEXT: [[b]] = Convert [[read]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return [[b]]

export function f({ b }: { b: number }) {
  return b;
}
