// RUN: lower
// CHECK-LABEL: function {{*}}name="nullishOfNull"
// CHECK: = TypeTest
// CHECK-NOT: NewRuntimeError
// CHECK: = Call {{*}}calleeName="v"
// CHECK-NEXT: [[nullError]] = NewRuntimeError runtimeError=ConstantAssignment name="e"
// CHECK-NEXT: Throw [[nullError]]
// CHECK-NOT: NewRuntimeError
// CHECK-LABEL: function {{*}}name="nullishOfNumber"
// CHECK: = TypeTest
// CHECK-NOT: NewRuntimeError
// CHECK: = Call {{*}}calleeName="v"
// CHECK-NEXT: [[numberError]] = NewRuntimeError runtimeError=ConstantAssignment name="d"
// CHECK-NEXT: Throw [[numberError]]
// CHECK-NOT: NewRuntimeError
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: NewRuntimeError
// CHECK: = Call {{*}}calleeName="v"
// CHECK-NEXT: [[plainError]] = NewRuntimeError runtimeError=ConstantAssignment name="c"
// CHECK-NEXT: Throw [[plainError]]

// RUN(KEPT): lower
// KEPT-LABEL: function {{*}}name="nullishOfNumber"
// KEPT: Branch {{*}}notTaken [[kept]](| 0)
// KEPT: [[kept]]([[present]]):
// KEPT-NOT: Throw
// KEPT: Return

export function nullishOfNull(v) {
  const e = null;
  e ??= v();
  return e;
}

export function nullishOfNumber(v) {
  const d = 1;
  d ??= v();
  return d;
}

export function plain(v) {
  const c = 1;
  c = v();
}
