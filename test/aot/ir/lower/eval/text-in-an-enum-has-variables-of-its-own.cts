// RUN: link
// CHECK: evalscope [[scope]] mode=Sloppy {{*}}bindings=[{kind=EvalVariables depth=1 operand={{*}}}, {name="q" depth=3
// CHECK: SetLiteralPrototype [[head]], [[null]]
// CHECK-NEXT: [[variables]] = FinishObject [[head]]
// CHECK: = DirectEval {{*}}[[variables]]{{*}}evalScope=[[scope]]

var q = "file";
enum E { A = (eval("var q = 'enum'"), 1) }
console.log(q, E.A);
