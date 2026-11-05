// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[read]] = PropGet [[receiver]] key="a"
// CHECK-NEXT: [[taken]] = Convert [[read]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return [[taken]]

export function f(r: { a: number }) {
  const { a: first } = r;
  return first;
}
