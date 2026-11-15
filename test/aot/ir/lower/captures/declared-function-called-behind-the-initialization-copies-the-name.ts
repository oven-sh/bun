// RUN: lower
// CHECK-NOT: PutEnvironmentField
// CHECK-LABEL: function {{*}}name="late"
// CHECK: = CallDirect {{*}}function=

// Nobody makes `walk`: whoever calls it enters the function itself. The first call stands behind `const stack`, so each call hands the list over, and no scope is made, neither in front of the early return nor behind it.
export function late(t: number): number {
  if (t < 0) return t;
  const stack: number[] = [];
  return walk(t);
  function walk(n: number): number {
    stack.push(n);
    return n ? walk(n - 1) : stack.length;
  }
}
