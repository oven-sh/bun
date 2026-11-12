// RUN(THROW): lower
// THROW: [[results]] = Yield
// THROW-NEXT: [[sent]] = ResultAt [[results]]
// THROW: Switch {{*}}-> case [[onThrow]](
// THROW: [[onThrow]]({{*}}) handler=
// THROW-NEXT: Throw [[sent]]

// RUN(RETURN): lower
// RETURN: Switch {{*}}, case [[onReturn]]({{*}}), otherwise
// RETURN: [[onReturn]](
// RETURN-NOT: Return
// RETURN: key="cleanup"
// RETURN: Return

// RUN(NEXT): lower
// NEXT: Switch {{*}}, otherwise [[onNext]](
// NEXT: [[onNext]](
// NEXT: key="after"

declare function after(): void;
declare function cleanup(): void;

export function* guarded() {
  try {
    yield 1;
    after();
  } finally {
    cleanup();
  }
}
