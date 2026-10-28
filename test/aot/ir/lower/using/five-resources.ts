// RUN: lower
// CHECK-LABEL: function {{*}}name="allSynchronous"
// CHECK-COUNT-5: role=DisposalCleanup
// CHECK-NOT: role=DisposalCleanup
// CHECK-LABEL: function {{*}}name="oneAsynchronous"
// CHECK-COUNT-5: role=DisposalCleanup
// CHECK-NOT: role=DisposalCleanup

// RUN(HELPERS): lower
// HELPERS-LABEL: function {{*}}name="allSynchronous"
// HELPERS-COUNT-5: builtin=CompilerHelpersGetDisposeMethod
// HELPERS-NOT: builtin=CompilerHelpersGet
// HELPERS-LABEL: function {{*}}name="oneAsynchronous"
// HELPERS-COUNT-2: builtin=CompilerHelpersGetDisposeMethod
// HELPERS-COUNT-1: builtin=CompilerHelpersGetAsyncDisposeMethod
// HELPERS-COUNT-2: builtin=CompilerHelpersGetDisposeMethod
// HELPERS-NOT: builtin=CompilerHelpersGet

declare function resource(): Disposable;
declare function asyncResource(): AsyncDisposable;

export function allSynchronous() {
  using a = resource();
  using b = resource();
  using c = resource();
  using d = resource();
  using e = resource();
}

export async function oneAsynchronous() {
  using a = resource();
  using b = resource();
  await using c = asyncResource();
  using d = resource();
  using e = resource();
}
