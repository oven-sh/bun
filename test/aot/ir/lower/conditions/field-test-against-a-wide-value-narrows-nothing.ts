// RUN: lower
// CHECK-LABEL: function {{*}}name="anyValue"
// CHECK: [[anyTest]] = StrictEq
// CHECK-NEXT: Branch [[anyTest]] -> taken {{*}}(| 1), notTaken {{*}}(| 1)
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[callTest]] = StrictEq
// CHECK-NEXT: Branch [[callTest]] -> taken [[callTaken]](), notTaken [[callOther]]()
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="otherField"
// CHECK: [[fieldTest]] = StrictEq
// CHECK-NEXT: Branch [[fieldTest]] -> taken [[fieldTaken]](), notTaken [[fieldOther]]()
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="unitValue"
// CHECK: = PropGet [[unitHolder]] key="kind"
// CHECK: [[unitTest]] = StrictEq
// CHECK-NEXT: Branch [[unitTest]] -> taken [[unitTaken]](| 0, 1), notTaken {{*}}(| 0, 1)
// CHECK: [[unitTaken]]([[unitRead]], [[unitWanted]]):
// CHECK-NEXT: = NarrowByField [[unitHolder]], [[unitRead]] key="kind"
// CHECK-LABEL: function {{*}}name="wideEnum"
// CHECK: [[enumTest]] = StrictEq
// CHECK-NEXT: Branch [[enumTest]] -> taken {{*}}(| 1), notTaken {{*}}(| 1)
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="wideNumber"
// CHECK: [[numberTest]] = StrictEq
// CHECK-NEXT: Branch [[numberTest]] -> taken {{*}}(| 1), notTaken {{*}}(| 1)
// CHECK-NOT: NarrowByField

declare function pick(): K;

enum K {
  A,
  B,
}

interface A {
  kind: K.A;
  a: number;
}

interface B {
  kind: K.B;
  b: number;
}

export function anyValue(x: A | B, wanted: any) {
  if (x.kind === wanted) return 1;
  return 0;
}

export function callResult(x: A | B) {
  if (x.kind === pick()) return 1;
  return 0;
}

export function otherField(x: A | B, y: A | B) {
  if (x.kind === y.kind) return 1;
  return 0;
}

export function unitValue(x: A | B, wanted: K.A) {
  if (x.kind === wanted) return 1;
  return 0;
}

export function wideEnum(x: A | B, wanted: K) {
  if (x.kind === wanted) return 1;
  return 0;
}

export function wideNumber(x: A | B, wanted: number) {
  if (x.kind === wanted) return 1;
  return 0;
}
