// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: = Call
// CHECK: = NewClosure function=
// CHECK-NOT: NewClosure
// CHECK-NOT: GlobalThis
// CHECK: = CallDirect {{*}}function=
// CHECK-NOT: NewClosure
// CHECK-LABEL: function {{*}}name="g"

// RUN(CALLED): lower
// CALLED-LABEL: function {{*}}name="onlyCalls"
// CALLED-NOT: NewClosure
// CALLED: = CallDirect {{*}}function=
// CALLED-NOT: NewClosure
// CALLED-LABEL: function {{*}}name="h"

// A declared function whose name is read is made where its scope is entered, in front of every use. One that is only called by its name is entered itself and never made.
export function f() {
  g();
  return g;
  function g() {}
}

export function onlyCalls() {
  h();
  function h() {}
}
