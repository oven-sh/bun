// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK-NOT: NewClosure
// CHECK: [[undefined]] = Undefined
// CHECK: Branch {{*}}-> taken [[taken]](| 0), notTaken [[join]]([[undefined]])
// CHECK: [[taken]](
// CHECK: [[closure]] = NewClosure function=
// CHECK-NEXT: Jump -> next [[join]]([[closure]])
// CHECK-NEXT: [[join]]([[f]]):
// CHECK-NEXT: = Call [[f]] calleeName="f"

module.exports = function outer(a) {
  if (a) function f() {}
  f();
};
