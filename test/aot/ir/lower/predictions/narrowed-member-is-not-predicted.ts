// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: Branch
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="x"
// CHECK-NOT: Convert
// CHECK: = Add [[read]],
// CHECK-NOT: Convert

// Nobody asks what a test narrows a member to, and a read of a member is not converted: the sum takes what the read behind the test gives.

export function f(p: { x: number | string }) {
  return typeof p.x === "number" ? p.x + 1 : 0;
}
