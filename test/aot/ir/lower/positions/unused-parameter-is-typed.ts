// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=number site=w{{*}}}]

export function f(x: number) {}
