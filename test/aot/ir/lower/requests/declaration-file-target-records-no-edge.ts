// RUN: link
// CHECK: layout {{*}}name="C"
// CHECK-NOT: supertypes=
// CHECK: layout

// An argument adds nothing to a family, also where a declaration file declares the parameter: C does not go below Declared.
/// <reference path="../types/imports/shapes.d.ts" />

class C {
  x = 1;
}

export function f() {
  take(new C());
}
