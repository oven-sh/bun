// RUN: lower
// CHECK-LABEL: function {{*}}name="noPendingAwait"
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[second]]
// CHECK: role=DisposalCleanup subject=[[second]]
// CHECK-NEXT: = CatchValue
// CHECK-NEXT: = TypeTest {{*}}testedType=undefined

declare function resource(): Disposable;
declare function asyncResource(): AsyncDisposable;

export async function noPendingAwait() {
  await using a = asyncResource();
  using b = resource();
}
