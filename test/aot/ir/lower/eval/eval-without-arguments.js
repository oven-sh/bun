// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[isEval]] = StrictEq
// CHECK-NEXT: Branch [[isEval]] -> taken [[direct]](), notTaken [[ordinary]](| 0)
// CHECK: [[direct]]():
// CHECK-NEXT: [[undefined]] = Undefined
// CHECK-NEXT: Jump -> next [[join]]([[undefined]])
// CHECK: [[ordinary]]([[other]]):
// CHECK: [[returned]] = Call
// CHECK: Jump -> next [[join]]([[returned]])

// RUN(NONE): lower
// NONE-NOT: DirectEval

export function f() {
  return eval();
}
