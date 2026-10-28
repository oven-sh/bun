// RUN: link
// CHECK: module [[entry]] path="{{*}}inner-binding-shadows-outer"
// CHECK: evalscope [[scope]] {{*}}bindings=[{name="a" kind=Constant operand=0}
// CHECK-NOT: {name="a"
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[inner]] = Call
// CHECK: = DirectEval [[text]], [[this]], [[newTarget]], [[inner]]{{*}}evalScope=[[scope]]

// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
export function f() {
  let a = 1;
  {
    const a = g();
    return eval("(a)");
  }
}
