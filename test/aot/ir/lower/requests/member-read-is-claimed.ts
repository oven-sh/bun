// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK: [[read]] = PropGet [[receiver]] key="x"
// CHECK-NEXT: [[returned]] = Convert [[read]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]

export function f(p: { x: number }) {
  return p.x;
}
