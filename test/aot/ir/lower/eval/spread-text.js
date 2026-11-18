// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[list]] = NewArray contents=
// CHECK: AppendSpread [[list]],
// CHECK: [[isEval]] = StrictEq [[callee]],
// CHECK-NEXT: Branch [[isEval]] -> taken [[direct]](), notTaken [[ordinary]](| 0)
// CHECK: [[direct]]():
// CHECK-NEXT: [[index]] = Integer @
// CHECK-NEXT: [[text]] = ElemGet [[list]], [[index]]
// CHECK: = DirectEval [[text]],
// CHECK: [[ordinary]]([[other]]):
// CHECK: = CallList [[other]], -, [[list]]

// RUN(ONE): lower
// ONE-COUNT-1: AppendSpread
// ONE-NOT: AppendSpread

export function f(a) {
  return eval(...a);
}
