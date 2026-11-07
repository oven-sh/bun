// RUN: link
// OPTIONS: type-errors=log
// CHECK: typesite {{*}}module=[[entry]] {{*}}kind=Parameter text="I"
// CHECK-NOT: module=[[entry]] {{*}}supertypes=
// CHECK: layout {{*}}name="I"
// CHECK-NOT: module=[[entry]] {{*}}supertypes=
// CHECK: module [[entry]] path=

interface I {
  x: number;
}

export function f(a: I) {
  const b: I = a;
  return b;
}
