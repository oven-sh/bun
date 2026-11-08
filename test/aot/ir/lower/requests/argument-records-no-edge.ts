// RUN: link
// CHECK: layout {{*}}name="C"
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]] module={{*}}fields=[{key="x"
// CHECK: function {{*}}name="g" {{*}}parameters=[{type=undefined|null|[[interface]] flags=

// An argument adds nothing to a family: C does not declare that it implements I, so it does not go below I. `g` tests what arrives.
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
