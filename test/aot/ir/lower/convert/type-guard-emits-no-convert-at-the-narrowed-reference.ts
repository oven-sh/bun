// RUN: lower
// CHECK-LABEL: function {{*}}name="narrowed"
// CHECK: b0([[n]]:
// CHECK-NOT: = Convert
// CHECK: Branch
// CHECK-NOT: = Convert
// CHECK: = PropGet [[n]] key="k"

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="untouched"
// OTHER: b0([[n]]: {{*}}, [[m]]:
// OTHER: Branch
// OTHER: = PropGet [[m]] key="k"

// `x is T` proves nothing, so the call of the guard converts nothing. Nobody asks the checker what a reference is narrowed to, so the reference behind the guard is converted to nothing either: the member is read from the parameter as it came. So is a reference that the guard does not narrow.
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
