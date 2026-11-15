// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = Add
// CHECK: = Mul
// CHECK: Return

// RUN(STORAGE): lower
// STORAGE-LABEL: function {{*}}name="f"
// STORAGE-NOT: NewObject
// STORAGE-NOT: GetEnvironmentField
// STORAGE-NOT: PutEnvironmentField
// STORAGE-NOT: GetModuleVariable
// STORAGE-NOT: PutModuleVariable
// STORAGE-NOT: CheckInitialized

export function f(a: number) {
  let b = a + 1;
  b = b * 2;
  return b;
}
