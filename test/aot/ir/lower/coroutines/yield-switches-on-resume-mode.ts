// RUN: lower
// CHECK-LABEL: function {{*}}name="echo"
// CHECK: [[results]] = Yield
// CHECK-NEXT: [[sent]] = ResultAt [[results]]
// CHECK-NEXT: [[mode]] = ResultAt [[results]] index=1
// CHECK-NEXT: Switch [[mode]] cases=[1, 2] -> case [[onThrow]](), case [[onReturn]](), otherwise [[onNext]]()

// RUN(THROW): lower
// THROW: [[results]] = Yield
// THROW-NEXT: [[sent]] = ResultAt [[results]]
// THROW: Switch {{*}}-> case [[onThrow]]()
// THROW: [[onThrow]]():
// THROW-NEXT: Throw [[sent]]

// RUN(RETURN): lower
// RETURN: Switch {{*}}, case [[onReturn]](), otherwise
// RETURN: [[onReturn]]():
// RETURN-NOT: = Await
// RETURN: Return

// RUN(NEXT): lower
// NEXT: Switch {{*}}, otherwise [[onNext]]()
// NEXT: [[onNext]]():
// NEXT: = Call

// RUN(PLAIN): lower
// PLAIN-NOT: handler=

declare function use(value: unknown): void;

export function* echo(): Generator<number, void, unknown> {
  const received = yield 1;
  use(received);
}
