// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[x]] = GetModuleVariable variable=
// CHECK-NEXT: = CheckInitialized [[x]] name="x"

export function f() {
  return x;
}

export let x = 1;
x = 2;
