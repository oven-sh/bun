// RUN: lower
// CHECK-LABEL: function {{*}}name="delegate"{{*}}IsAsync, IsGenerator
// CHECK: [[iterator]] = IteratorOpen {{*}}iteratorKind=Async
// CHECK-COUNT-3: = IteratorResume [[iterator]], {{*}}iteratorKind=Async
// CHECK-NOT: = IteratorResume

// RUN(SUSPEND): lower
// SUSPEND: LoopHint
// SUSPEND-NEXT: [[request]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// SUSPEND-NEXT: [[results]] = Yield [[request]]
// SUSPEND-NEXT: [[sent]] = ResultAt [[results]]
// SUSPEND-NEXT: [[mode]] = ResultAt [[results]] index=1
// SUSPEND-NEXT: Switch [[mode]] cases=[1, 2] -> case [[resumeThrow]]([[sent]]), case [[resumeReturn]]([[sent]]), otherwise [[resumeNext]]([[sent]])

// RUN(AWAITS): lower
// AWAITS-NOT: = Await
// AWAITS-NOT: handler=

export async function* delegate(inner: AsyncIterable<number>) {
  yield* inner;
}
