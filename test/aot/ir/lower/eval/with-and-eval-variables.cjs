// RUN: link
// CHECK: module [[entry]] path="{{*}}with-and-eval-variables"
// CHECK: evalscope [[scope]] mode=Sloppy flags=[IsInFunction, AllowsNewTarget] bindings=[{kind=WithObject depth=1 operand=
// CHECK: {kind=EvalVariables depth=
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[head]] = NewObject layout=
// CHECK-NEXT: [[null]] = Null
// CHECK-NEXT: SetLiteralPrototype [[head]], [[null]]
// CHECK-NEXT: [[variables]] = FinishObject [[head]]
// CHECK: [[with]] = ToObject
// CHECK: = DirectEval {{*}}[[with]], [[variables]]{{*}}evalScope=[[scope]]

function f(o) {
  with (o) eval("var v");
}

module.exports = f;
