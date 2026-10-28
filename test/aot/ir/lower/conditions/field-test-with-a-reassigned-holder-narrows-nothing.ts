// RUN: lower
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: = PropGet [[plainHolder]] key="kind"
// CHECK: [[plainTest]] = StrictEq
// CHECK-NEXT: Branch [[plainTest]] -> taken [[plainTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[plainTaken]]([[plainRead]]):
// CHECK-NEXT: = NarrowByField [[plainHolder]], [[plainRead]] key="kind"
// CHECK-LABEL: function {{*}}name="stored"
// CHECK: = PropGet [[before]] key="kind"
// CHECK: [[storedTest]] = StrictEq
// CHECK-NEXT: Branch [[storedTest]] -> taken [[storedTaken]](), notTaken [[storedOther]]()
// CHECK-NOT: [[before]]

// RUN(NOWHERE): lower
// NOWHERE-LABEL: function {{*}}name="stored"
// NOWHERE-NOT: NarrowByField

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

export function plain(x: A | B, other: A | B) {
  if (x.kind === K.A) return x;
  return other;
}

export function stored(x: A | B, other: A | B) {
  if (x.kind === ((x = other), K.A)) return x;
  return other;
}
