// RUN: link
// CHECK: layout {{*}}name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[interface]]]
// CHECK: layout [[interface]] name="I"

interface I {
  x: number;
}

class C {
  x = 1;
}

function g(i: I) {}

export function f() {
  g(new C());
}
