// RUN: lower
// CHECK-LABEL: function {{*}}name="readDeclaredLater"
// CHECK: [[read]] = GetModuleVariable
// CHECK: CheckInitialized [[read]] name="declaredLater"
// CHECK-LABEL: function {{*}}name="readLeading"
// CHECK-NOT: GetModuleVariable
// CHECK-NOT: CheckInitialized
// CHECK: Return

export const leading = 1;
const label = "text";

export function readLeading() {
  return leading + label;
}

export function readDeclaredLater() {
  return declaredLater;
}

export const declaredLater = 2;
