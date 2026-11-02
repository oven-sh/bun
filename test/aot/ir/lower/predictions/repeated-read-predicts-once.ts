// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: Branch
// CHECK-NOT: Convert
// CHECK: = PropGet [[narrowed]] key="x"
// CHECK-NEXT: = PropGet [[narrowed]] key="x"
// CHECK-NOT: Convert [[narrowed]]

// `undefined` and `null` are members of every type that holds a reference, so a test that excludes only them leaves the type of `v` as
// it is, and neither read of `v` is converted.

declare const o: any;

export function f() {
  const v = o as { x: number } | null;
  if (v) {
    return v.x + v.x;
  }
  return 0;
}
