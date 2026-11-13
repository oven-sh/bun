// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|[[k]]|[[n]] flags={{*}}}]
// CHECK: ([[value]]:
// CHECK-NOT: Convert
// CHECK: Branch
// CHECK-NOT: Convert
// CHECK: = PropGet [[value]] key="k"

// Nobody asks what a type guard narrows a name to: the use behind the call reads the parameter itself.

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
