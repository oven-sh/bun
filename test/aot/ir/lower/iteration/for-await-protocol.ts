// RUN: lower
// CHECK-LABEL: function {{*}}name="drain"{{*}}IsAsync
// CHECK: [[iterator]] = IteratorOpen {{*}}iteratorKind=Async
// CHECK-NOT: handler=
// CHECK: LoopHint
// CHECK-NEXT: [[step]] = IteratorResume [[iterator]] iteratorKind=Async
// CHECK-NEXT: [[done]] = ResultAt [[step]]
// CHECK-NEXT: [[value]] = ResultAt [[step]] index=1
// CHECK-NEXT: Branch [[done]] -> taken [[after]]({{*}}), notTaken [[body]]({{*}})
// CHECK: role=IterationCleanup subject=[[iterator]]
// CHECK-NEXT: [[exception]] = CatchException
// CHECK-NEXT: IteratorClose [[iterator]] iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow [[exception]]

// RUN(CLOSES): lower
// CLOSES-COUNT-2: IteratorClose {{*}}iteratorKind=Async
// CLOSES-NOT: IteratorClose

// RUN(PROTOCOL): lower
// PROTOCOL-NOT: = Await
// PROTOCOL-NOT: @@asyncIterator
// PROTOCOL-NOT: key="next"
// PROTOCOL-NOT: key="return"
// PROTOCOL-NOT: key="done"
// PROTOCOL-NOT: role=CatchHandler

declare function use(value: unknown): void;
declare const stop: boolean;

export async function drain(source: AsyncIterable<number>) {
  for await (const item of source) {
    if (stop) break;
    use(item);
  }
}
