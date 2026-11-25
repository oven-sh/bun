// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="declares"
// CHECK-NOT: handler=
// CHECK: key="resource"
// CHECK: = Call
// CHECK-NOT: handler=
// CHECK: TypeTest [[resource]] testedType=undefined|null
// CHECK-NOT: handler=
// CHECK: key=@@dispose
// CHECK-NOT: handler=
// CHECK: testedType=function
// CHECK: handler=[[landing]](
// CHECK: integer=1
// CHECK: [[landing]]({{*}}) role=DisposalCleanup subject=[[resource]]

// RUN(KEYS): lower
// KEYS-COUNT-1: @@dispose
// KEYS-NOT: @@dispose

// RUN(ERRORS): lower
// ERRORS: RequireObject {{*}}runtimeError=ResourceNotObject
// ERRORS: NewRuntimeError runtimeError=DisposeMethodAbsent
// ERRORS: NewRuntimeError runtimeError=DisposeMethodNotCallable

declare function use(value: unknown): void;
declare function resource(): Disposable;

export function declares() {
  using a = resource();
  use(1);
}
