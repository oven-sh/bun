// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|[[k]]|[[n]] site=w{{*}}}]
// CHECK: Branch
// CHECK: [[narrowed]] = Convert {{*}}declared={type=undefined|null|[[k]]} illTypedCause=Assertion @
// CHECK: = PropGet [[narrowed]] key="k"

interface K {
  kind: 1;
  k: number;
}

interface N {
  kind: 2;
}

function isK(n: K | N): n is K {
  return n.kind === 1;
}

export function f(n: K | N) {
  if (isK(n)) return n.k;
  return 0;
}
