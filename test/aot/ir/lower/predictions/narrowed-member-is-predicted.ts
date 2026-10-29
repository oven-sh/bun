// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: Branch
// CHECK: [[read]] = PropGet {{*}}key="x"
// CHECK-NEXT: [[narrowed]] = Convert [[read]] declared={type=number} illTypedCause=Assertion @
// CHECK: = Add [[narrowed]],

export function f(p: { x: number | string }) {
  return typeof p.x === "number" ? p.x + 1 : 0;
}
