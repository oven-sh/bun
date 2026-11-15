// RUN: link
// CHECK: layout {{*}}name="C"
// CHECK-NOT: supertypes=
// CHECK: layout [[interface]] module={{*}}fields=[{key="x"
// CHECK-NOT: supertypes=
// CHECK: variable {{*}}name="f"
// CHECK: function {{*}}name="h" module={{*}}parameters=[{type=Array<undefined|null|[[interface]]>

// An argument adds to no family: `C` does not go below `I`, the type of what the rest parameter holds.
interface I {
  x: number;
}

class C {
  x = 1;
}

function h(...all: I[]) {}

export function f() {
  h(new C());
}
