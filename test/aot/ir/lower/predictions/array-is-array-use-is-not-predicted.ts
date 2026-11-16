// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: ([[x]]: undefined|null|string|Array<number>):
// CHECK-NOT: Convert [[x]]
// CHECK: Branch
// CHECK-NOT: Convert [[x]]
// CHECK: = Call {{*}}calleeName="Array.isArray"
// CHECK: [[list]] = NarrowByTest [[x]],
// CHECK-NEXT: = PropGet [[list]] key="length"

// Nobody asks what a test narrows a name to: the use behind the test reads the parameter under a name that claims no type.

export function f(x: string | number[]) {
  return Array.isArray(x) ? x.length : 0;
}
