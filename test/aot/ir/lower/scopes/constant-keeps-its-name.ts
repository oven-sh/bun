// RUN: lower
// CHECK-LABEL: function {{*}}name="early"
// CHECK: [[second]] = GetModuleVariable
// CHECK: CheckInitialized [[second]] name="second"
// CHECK: [[size]] = GetModuleVariable
// CHECK: CheckInitialized [[size]] name="size"
// CHECK: [[sum]] = GetModuleVariable
// CHECK: CheckInitialized [[sum]] name="sum"

const first = early(),
  second = 2,
  size = "named".length,
  sum = 1 + second;

function early() {
  return [second, size, sum];
}

export function late() {
  return [first, second];
}
