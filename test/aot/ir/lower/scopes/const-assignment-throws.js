// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[error]] = NewRuntimeError runtimeError=ConstantAssignment name="c"
// CHECK-NEXT: Throw [[error]]
// CHECK-NOT: Return
// CHECK-LABEL: function {{*}}name="shared"
// CHECK: PutEnvironmentField
// CHECK-NOT: PutEnvironmentField
// CHECK: [[sharedError]] = NewRuntimeError runtimeError=ConstantAssignment name="c"
// CHECK-NEXT: Throw [[sharedError]]
// CHECK-NOT: PutEnvironmentField

export function f() {
  const c = 1;
  c = 2;
}

export function shared() {
  const read = () => c;
  const c = 1;
  c = 2;
  return read;
}
