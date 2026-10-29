// RUN: link
// CHECK: layout [[k]] name="K"
// CHECK: function {{*}}name="narrowed" module=
// CHECK-NOT: = Convert {{*}}declared={type=undefined|null|[[k]]}
// CHECK-NOT: = Convert {{*}}declared={type=undefined|null|[[k]] site=
// CHECK: Branch
// CHECK: [[reference]] = Convert {{*}}declared={type=undefined|null|[[k]]
// CHECK-NOT: |
// CHECK: illTypedCause=Assertion
// CHECK: = PropGet [[reference]] key="k"

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="untouched"
// OTHER: b0([[n]]: {{*}}, [[m]]:
// OTHER: Branch
// OTHER: = PropGet [[m]] key="k"

// `x is T` proves nothing, so the call of the guard converts nothing. The reference behind it, whose type for the checker is narrower than its binding's, is converted to that type alone, and the member is read from the converted value. No family covers a narrowing, so it has the cause of an assertion. A reference that the guard does not narrow is read as it is.
interface K {
  kind: 1;
  k: number;
}

interface N {
  kind: 2;
}

export function isK(n: K | N): n is K {
  return n.kind === 1;
}

export function narrowed(n: K | N) {
  if (isK(n)) return n.k;
  return 0;
}

export function untouched(n: K | N, m: K) {
  if (isK(n)) return m.k;
  return 0;
}
