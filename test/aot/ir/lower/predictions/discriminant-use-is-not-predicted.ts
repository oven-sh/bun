// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|[[k]]|[[n]] flags={{*}}}]
// CHECK: Branch
// CHECK: [[narrowed]] = NarrowByField {{*}}key="kind"
// CHECK-NOT: Convert
// CHECK: = PropGet [[narrowed]] key="k"

// Nobody asks what the test narrows `n` to: `NarrowByField` says which field was compared, and the use behind the test reads what it gives.

interface K {
  kind: 1;
  k: number;
}

interface N {
  kind: 2;
}

export function f(n: K | N) {
  if (n.kind === 1) return n.k;
  return 0;
}
