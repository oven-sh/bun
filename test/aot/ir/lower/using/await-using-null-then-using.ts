// RUN: lower
// CHECK-LABEL: function {{*}}name="pendingAwait"
// CHECK: builtin=CompilerHelpersGetDisposeMethod
// CHECK-NEXT: = Call {{*}}, -, [[first]]
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

export async function pendingAwait() {
  using a = resource();
  await using b = null;
}
