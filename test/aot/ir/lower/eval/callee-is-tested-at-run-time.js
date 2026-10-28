// RUN: link
// CHECK: module [[entry]] path="{{*}}callee-is-tested-at-run-time"
// CHECK: evalscope [[scope]] flags=
// CHECK: function [[f]] name="f" module=[[entry]]
// CHECK: [[eval]] = Builtin builtin=Eval
// CHECK-NEXT: [[isEval]] = StrictEq [[callee]], [[eval]]
// CHECK-NEXT: Branch [[isEval]] -> taken [[direct]](), notTaken [[ordinary]](| 0)
// CHECK: [[direct]]():
// CHECK: [[evaluated]] = DirectEval {{*}}evalScope=[[scope]]
// CHECK: Jump -> next [[join]]([[evaluated]])
// What is called there is any function but eval.
// CHECK: [[ordinary]]([[other]]):
// CHECK: [[returned]] = Call [[other]],
// CHECK: Jump -> next [[join]]([[returned]])
// CHECK: [[join]]([[result]]):
// CHECK: Return [[result]]

// RUN(ONE): lower
// ONE-COUNT-1: = DirectEval
// ONE-NOT: = DirectEval

export function f(s) {
  return eval(s);
}
