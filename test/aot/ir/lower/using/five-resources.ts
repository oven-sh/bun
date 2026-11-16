// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="allSynchronous"
// CHECK-COUNT-5: role=DisposalCleanup
// CHECK-NOT: role=DisposalCleanup
// CHECK-LABEL: function {{*}}name="oneAsynchronous"
// CHECK-COUNT-5: role=DisposalCleanup
// CHECK-NOT: role=DisposalCleanup

// RUN(HELPERS): lower
// HELPERS-LABEL: function {{*}}name="allSynchronous"
// HELPERS-COUNT-5: key=@@dispose
// HELPERS-NOT: key=@@dispose
// HELPERS-LABEL: function {{*}}name="oneAsynchronous"
// HELPERS-COUNT-2: key=@@dispose
// HELPERS-COUNT-1: builtin=CompilerHelpersGetAsyncDisposeMethod
// HELPERS-COUNT-2: key=@@dispose
// HELPERS-NOT: key=@@dispose

declare function resource(): Disposable;
declare function asyncResource(): AsyncDisposable;
declare function use(value: unknown): void;

export function allSynchronous() {
  using a = resource();
  using b = resource();
  using c = resource();
  using d = resource();
  using e = resource();
  use(0);
}

export async function oneAsynchronous() {
  using a = resource();
  using b = resource();
  await using c = asyncResource();
  using d = resource();
  using e = resource();
  use(0);
}
