// RUN: lower
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: [[iterator]] = IteratorOpen
// CHECK-NOT: handler=
// CHECK: LoopHint
// CHECK-NEXT: [[step]] = IteratorResume [[iterator]]
// CHECK-NEXT: [[done]] = ResultAt [[step]]
// CHECK-NEXT: [[value]] = ResultAt [[step]] index=1
// CHECK-NEXT: Branch [[done]] -> taken [[after]]({{*}}), notTaken [[body]]({{*}})
// CHECK: handler=[[landing]](
// CHECK: [[landing]]({{*}}) role=IterationCleanup subject=[[iterator]]
// CHECK-NEXT: [[exception]] = CatchException
// CHECK-NEXT: IteratorClose [[iterator]] completion=Throw
// CHECK-NEXT: Rethrow [[exception]]

// RUN(CLOSES): lower
// CLOSES-COUNT-1: IteratorClose
// CLOSES-NOT: IteratorClose

declare function use(value: unknown): void;

export function visit(items: number[]) {
  for (const item of items) use(item);
}
