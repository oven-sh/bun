// RUN: lower
// CHECK-LABEL: function {{*}}name="clear"
// CHECK-NOT: Convert
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: ElemSet {{*}}, [[nothing]]
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="count"
// CHECK: [[counted]] = Convert {{*}}declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return [[counted]]
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: [[plain]] = Convert {{*}}declared={type=number} @
// CHECK-NEXT: Return [[plain]]

// `undefined!` has the type `never`, which the checker lets into everything, and `n!` loses its `undefined`. A number is held raw, so whoever believed such a flow
// would take `undefined` for one: the conversion to the written result says that it rests on an assertion. A store into an element is converted to nothing, and
// the list takes the `undefined` as it is.
const flags: boolean[] = [];

export function clear(index: number): void {
  flags[index] = undefined!;
}

export function count(n: number | undefined): number {
  return n!;
}

export function shown(n: number | undefined): number {
  return n === undefined ? 0 : n;
}
