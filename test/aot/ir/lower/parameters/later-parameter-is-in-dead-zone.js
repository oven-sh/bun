// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[absent]] = Absent
// CHECK-NEXT: = CheckInitialized [[absent]] name="b"

export function f(a = b, b) {}
