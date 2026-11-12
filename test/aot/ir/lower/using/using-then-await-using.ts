// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="noPendingAwait"
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[second]]
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
