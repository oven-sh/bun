// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="pendingAwait"
// CHECK: TypeTest [[first]] testedType=undefined|null
// CHECK: [[read]] = PropGet {{*}} key=@@dispose
// CHECK-NEXT: TypeTest [[read]] testedType=function
// CHECK: role=DisposalCleanup subject=[[first]]:
// CHECK-NEXT: = CatchValue
// CHECK-NEXT: Branch
// CHECK-NOT: testedType=undefined
// CHECK: Branch
// CHECK-NOT: testedType=undefined
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: = Await [[nothing]]
// CHECK: testedType=undefined

// RUN(AWAITS): lower
// AWAITS-COUNT-4: = Await
// AWAITS-NOT: = Await

declare function resource(): Disposable;
declare function use(value: unknown): void;

export async function pendingAwait() {
  using a = resource();
  await using b = null;
  use(0);
}
