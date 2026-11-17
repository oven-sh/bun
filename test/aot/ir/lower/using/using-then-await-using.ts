// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="noPendingAwait"
// CHECK: TypeTest [[second]] testedType=undefined|null
// CHECK: [[read]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[read]] testedType=function
// CHECK: role=DisposalCleanup subject=[[second]]
// CHECK-NEXT: = CatchValue
// CHECK-NEXT: = TypeTest {{*}}testedType=undefined

declare function resource(): Disposable;
declare function asyncResource(): AsyncDisposable;
declare function use(value: unknown): void;

export async function noPendingAwait() {
  await using a = asyncResource();
  using b = resource();
  use(0);
}
