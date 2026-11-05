// Every suspension lists what the names of the parameters hold there: the value behind a default, the names of a pattern and not its source, and what was stored last.
// Behind them it lists the receiver, which a suspended call holds as well.
// RUN: lower
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: b0([[receiver]]: anything, {{*}}: function, [[first]]: {{*}}):
// CHECK: InitialYield [[first]], [[receiver]] @
// CHECK: = Yield {{*}}, [[first]], [[receiver]] @
// CHECK-LABEL: function {{*}}name="waits"
// CHECK: b0([[receiver]]: {{*}}, [[plain]]: {{*}}, [[source]]: {{*}}, [[argument]]: {{*}}):
// CHECK: [[inner]] = PropGet {{*}} key="inner"
// CHECK: = Await {{*}}, [[plain]], [[inner]], [[defaulted]], [[receiver]] @
// CHECK: [[made]] = Call
// CHECK-NEXT: [[stored]] = Convert [[made]]
// CHECK: = Await {{*}}, [[stored]], [[inner]], [[defaulted]], [[receiver]] @

declare function make(): object;
declare function pause(): Promise<void>;

export async function waits(plain: object, { inner }: { inner: object }, defaulted: object = make()) {
  await pause();
  plain = make();
  await pause();
}

export function* steps(first: object) {
  yield 1;
}
