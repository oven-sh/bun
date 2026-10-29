// RUN(NEXT): lower
// NEXT: [[iterator]] = IteratorOpen
// NEXT: [[undefined]] = Undefined
// NEXT-NEXT: Jump -> next [[resumeNext]]([[undefined]])
// NEXT: [[resumeNext]]([[sent]]{{*}}):
// NEXT-NEXT: [[step]] = IteratorResume [[iterator]], [[sent]] {{*}}readsValueWhenDone
// NEXT-NEXT: [[done]] = ResultAt [[step]]
// NEXT-NEXT: [[value]] = ResultAt [[step]] index=1
// NEXT-NEXT: Branch [[done]] -> taken [[exit]]([[value]]), notTaken [[suspend]]([[value]])

// RUN(THROW): lower
// THROW: [[iterator]] = IteratorOpen
// THROW: [[step]] = IteratorResume [[iterator]], {{*}}resumeMode=Throw{{*}}readsValueWhenDone
// THROW-NEXT: [[done]] = ResultAt [[step]]
// THROW-NEXT: [[value]] = ResultAt [[step]] index=1
// THROW-NEXT: Branch [[done]] -> taken [[exit]]([[value]]), notTaken [[suspend]]([[value]])

// RUN(RETURN): lower
// RETURN: [[iterator]] = IteratorOpen
// RETURN: [[step]] = IteratorResume [[iterator]], {{*}}resumeMode=Return{{*}}readsValueWhenDone
// RETURN-NEXT: [[done]] = ResultAt [[step]]
// RETURN-NEXT: [[value]] = ResultAt [[step]] index=1
// RETURN-NEXT: Branch [[done]] -> taken [[finished]]([[value]]), notTaken [[suspend]]([[value]])
// RETURN: [[finished]]([[returned]]):
// RETURN: Return

// RUN(SUSPEND): lower
// SUSPEND: LoopHint
// SUSPEND: [[results]] = Yield
// SUSPEND-NEXT: [[sent]] = ResultAt [[results]]
// SUSPEND-NEXT: [[mode]] = ResultAt [[results]] index=1
// SUSPEND-NEXT: Switch [[mode]] cases=[1, 2] -> case [[resumeThrow]]([[sent]]), case [[resumeReturn]]([[sent]]), otherwise [[resumeNext]]([[sent]])

// RUN(COUNTS): lower
// COUNTS-COUNT-3: = IteratorResume
// COUNTS-NOT: = IteratorResume

// RUN(PROTOCOL): lower
// PROTOCOL-NOT: key="next"
// PROTOCOL-NOT: key="throw"
// PROTOCOL-NOT: key="return"
// PROTOCOL-NOT: key="done"
// PROTOCOL-NOT: key="value"
// PROTOCOL-NOT: NewRuntimeError
// PROTOCOL-NOT: IteratorClose
// PROTOCOL-NOT: iteratorKind=Async
// PROTOCOL-NOT: = Await
// PROTOCOL-NOT: handler=

declare function use(value: unknown): void;

export function* delegate(inner: Iterable<number>) {
  const result = yield* inner;
  use(result);
}
