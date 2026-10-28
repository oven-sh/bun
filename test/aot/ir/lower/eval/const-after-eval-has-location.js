// RUN: link
// CHECK: module [[entry]] path="{{*}}const-after-eval-has-location"
// CHECK: evalscope [[scope]] {{*}}bindings=[{name="c" kind=Constant layout=[[layout]] field=0 operand=0}
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[environment]] = NewObject layout=[[layout]]
// CHECK: = DirectEval [[text]], [[this]], [[newTarget]], [[environment]]{{*}}evalScope=[[scope]]
// CHECK: PutEnvironmentField [[environment]], {{*}}layout=[[layout]]

// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
export function f() {
  eval("(c)");
  const c = 1;
}
