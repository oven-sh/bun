// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[TakesCallee, HasExplicitName]
// CHECK: b0([[callee]]: function):
// CHECK-NOT: NewClosure
// CHECK: Return [[callee]]
// CHECK-LABEL: function {{*}}name="h"{{*}}flags=[HasExplicitName]
// CHECK: b0():

export const mentioned = function f() {
  return f;
};

export const unmentioned = function h() {};
