// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: CheckInitialized
// CHECK: = Call {{*}}calleeName="g"
// CHECK: [[absent]] = Absent
// CHECK: = CheckInitialized [[absent]] name="x"

declare function g(): unknown;

export function f() {
  // @ts-ignore
  x = g();
  let x: unknown;
}
