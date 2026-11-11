// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK-COUNT-2: = GetModuleVariable
// CHECK-NOT: Convert
// CHECK: [[sum]] = Add
// CHECK-NEXT: Return [[sum]]

export let n: number = 1;

export function f() {
  return n + n;
}
