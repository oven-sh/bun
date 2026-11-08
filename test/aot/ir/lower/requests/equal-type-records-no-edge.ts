// RUN: link
// CHECK-NOT: supertypes=
// CHECK: layout {{*}}fields=[{key="x"
// CHECK-NOT: supertypes=
// CHECK: module {{*}}path=

interface I {
  x: number;
}

export function f(a: I) {
  const b: I = a;
  return b;
}
