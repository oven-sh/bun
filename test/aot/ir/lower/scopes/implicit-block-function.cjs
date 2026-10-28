// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK-NOT: NewClosure
// CHECK: [[undefined]] = Undefined
// CHECK: Branch {{*}}-> taken [[taken]](
// CHECK: [[taken]](
// CHECK: = NewClosure function=
// CHECK: Jump -> next [[join]]([[undefined]])
// CHECK-NEXT: [[join]]([[f]]):
// CHECK-NEXT: [[callee]] = Convert [[f]] declared={type=undefined|null|f{{*}} flags=[IsExpected]}
// CHECK-NEXT: = Call [[callee]] calleeName="f"

module.exports = function outer(a) {
  if (a) function f() {}
  f();
};
