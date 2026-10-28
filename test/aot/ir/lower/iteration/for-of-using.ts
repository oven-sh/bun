// RUN: lower
// CHECK-LABEL: function {{*}}name="release"
// CHECK: [[iterator]] = IteratorOpen
// CHECK: role=IterationCleanup subject=[[iterator]]

// RUN(DISPOSAL): lower
// DISPOSAL: LoopHint
// DISPOSAL: role=DisposalCleanup

// RUN(CLOSES): lower
// CLOSES-COUNT-1: IteratorClose {{*}}completion=Throw
// CLOSES-NOT: IteratorClose

declare function use(value: unknown): void;
declare const skip: boolean;

export function release(resources: Disposable[]) {
  for (using resource of resources) {
    if (skip) continue;
    use(resource);
  }
}
