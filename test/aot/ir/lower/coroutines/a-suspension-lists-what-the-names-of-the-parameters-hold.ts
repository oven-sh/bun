// Every suspension lists what the names of the parameters that the body names hold there: the value behind a default, the names of a pattern and not
// its source, and what was stored last. A parameter that the body never names is not held: JavaScriptCore keeps it in a register of the wrapper.
// RUN: lower
// CHECK-LABEL: function {{*}}name="namedByAClosure"
// CHECK: b0({{*}}: anything, [[seen]]: {{*}}, [[unseen]]: {{*}}):
// CHECK: = Await {{*}}, [[seen]] @
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: b0({{*}}: anything, {{*}}: function, [[first]]: {{*}}, [[second]]: {{*}}):
// CHECK: InitialYield [[second]] @
// CHECK: = Yield {{*}}, [[second]] @
// CHECK-LABEL: function {{*}}name="waits"
// CHECK: b0([[receiver]]: {{*}}, [[plain]]: {{*}}, [[source]]: {{*}}, [[argument]]: {{*}}, [[unnamed]]: {{*}}):
// CHECK: [[read]] = PropGet {{*}} key="inner"
// CHECK-NEXT: [[inner]] = Convert [[read]]
// CHECK: = Await {{*}}, [[plain]], [[inner]], [[defaulted]] @
// CHECK: [[made]] = Call
// CHECK-NEXT: [[stored]] = Convert [[made]]
// CHECK: = Await {{*}}, [[stored]], [[inner]], [[defaulted]] @

declare function make(): object;
declare function pause(): Promise<void>;
declare function use(value: unknown): void;

export async function waits(plain: object, { inner }: { inner: object }, defaulted: object = make(), unnamed: object) {
  await pause();
  plain = make();
  await pause();
  use(inner);
  use(defaulted);
}

export function* steps(first: object, second: object) {
  yield 1;
  use(second);
}

export async function namedByAClosure(seen: object, unseen: object) {
  await pause();
  return () => seen;
}
