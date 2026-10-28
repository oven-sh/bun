// RUN: link
// CHECK: module [[entry]] path="{{*}}mutable-binding-has-location"
// CHECK: evalscope [[scope]] flags=[IsInFunction, AllowsNewTarget] bindings=[{name="a" layout=[[layout]] field=0 operand=0}
// CHECK-NOT: kind=EvalVariables
// CHECK-NOT: kind=WithObject
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[environment]] = NewObject layout=[[layout]]
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]]
// CHECK: = DirectEval [[text]], [[this]], [[newTarget]], [[environment]]{{*}}evalScope=[[scope]]

export function f() {
  let a = 1;
  return eval("a = 2");
}
