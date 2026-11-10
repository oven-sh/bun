// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="a"
// CHECK-NEXT: Return [[read]]

// A read of a member is converted to nothing, also where an index signature says what it holds.
export function f(r: { [key: string]: number }) {
  return r.a;
}
