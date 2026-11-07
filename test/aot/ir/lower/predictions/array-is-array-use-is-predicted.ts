// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[x]]: undefined|null|string|Array<number>):
// CHECK-NOT: Convert [[x]]
// CHECK: Branch
// CHECK: [[narrowed]] = Convert [[x]] declared={type=undefined|null|Array<number>} illTypedCause=Assertion
// CHECK: = PropGet [[narrowed]] key="length"

export function f(x: string | number[]) {
  return Array.isArray(x) ? x.length : 0;
}
