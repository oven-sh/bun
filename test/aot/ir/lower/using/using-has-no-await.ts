// RUN: lower
// CHECK-LABEL: function {{*}}name="synchronous"
// CHECK-NOT: Await
// CHECK-NOT: = Boolean
// CHECK: role=DisposalCleanup
// CHECK-NOT: Await
// CHECK-NOT: = Boolean

declare function resource(): Disposable;

export function synchronous() {
  using a = resource();
  using b = resource();
}
