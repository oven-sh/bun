// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[absent]] = Absent
// CHECK: [[x]] = CheckInitialized [[absent]] name="x"
// CHECK-NOT: CheckInitialized
// CHECK: Return [[x]]

export function f() {
  // @ts-ignore
  let x: unknown = x;
  return x;
}
