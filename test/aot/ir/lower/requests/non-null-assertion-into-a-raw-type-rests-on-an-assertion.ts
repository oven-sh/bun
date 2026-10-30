// RUN: lower
// CHECK-LABEL: function {{*}}name="clear"
// CHECK: [[nothing]] = Undefined
// CHECK: [[flag]] = Convert [[nothing]] declared={type=boolean site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="count"
// CHECK: [[counted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=Assertion
// CHECK-NEXT: Return [[counted]]
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: [[plain]] = Convert {{*}}declared={type=number site=w{{*}}} @
// CHECK-NEXT: Return [[plain]]

// `undefined!` has the type `never`, which the checker lets into everything, and `n!` loses its `undefined`. A boolean and a number are held raw, so whoever
// believed such a flow would take `undefined` for one.
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
