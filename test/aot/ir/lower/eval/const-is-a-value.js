// RUN: link
// CHECK: module [[entry]] path="{{*}}const-is-a-value"
// CHECK: evalscope [[scope]] {{*}}bindings=[{name="c" kind=Constant operand=0}
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[c]] = Call
// CHECK: = DirectEval [[text]], [[this]], [[newTarget]], [[c]]{{*}}evalScope=[[scope]]

// RUN(VALUE): lower
// VALUE-NOT: = NewObject
// VALUE-NOT: EnvironmentField

// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
export function f() {
  const c = g();
  return eval("(c)");
}
