// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: NewClosure
// CHECK-NOT: GlobalThis
// CHECK: = CallDirect {{*}}function=
// CHECK: = NewClosure function=
// CHECK: Return
// CHECK-LABEL: function {{*}}name="g"

// RUN(CALLED): lower
// CALLED-LABEL: function {{*}}name="onlyCalls"
// CALLED-NOT: NewClosure
// CALLED: = CallDirect {{*}}function=
// CALLED-NOT: NewClosure
// CALLED-LABEL: function {{*}}name="h"

export function f() {
  g();
  return g;
  function g() {}
}

export function onlyCalls() {
  h();
  function h() {}
}
