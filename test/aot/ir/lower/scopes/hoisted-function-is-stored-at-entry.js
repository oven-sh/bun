// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: = Call
// CHECK: = NewClosure function=
// CHECK-NOT: NewClosure
// CHECK-NOT: GlobalThis
// CHECK: = Call {{*}}calleeName="g"
// CHECK-NOT: NewClosure
// CHECK-LABEL: function {{*}}name="g"

export function f() {
  g();
  function g() {}
}
