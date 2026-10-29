// RUN: link
// CHECK: layout {{*}}name="C"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[declared]]]
// CHECK: layout [[declared]] name="Declared"

/// <reference path="../types/imports/shapes.d.ts" />

class C {
  x = 1;
}

export function f() {
  take(new C());
}
