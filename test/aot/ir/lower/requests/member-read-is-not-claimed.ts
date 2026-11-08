// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet [[receiver]] key="x"
// CHECK-NEXT: Return [[read]]

// A read of a member is converted to nothing: the layout says what the field is declared to hold. The result of `f` has no annotation, so it is untyped.
export function f(p: { x: number }) {
  return p.x;
}
