// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|string flags={{*}}}]
// CHECK: ([[x]]: undefined|null|string):
// CHECK-NOT: Convert
// CHECK: Return [[x]]

// `x!` emits nothing, and the result has no annotation: the parameter is returned as it is.

export function f(x: string | undefined) {
  return x!;
}
