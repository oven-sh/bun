// RUN: lower
// CHECK-LABEL: function {{*}}name="comma"
// CHECK: = Call
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = Call
// CHECK-LABEL: function {{*}}name="optional"
// CHECK: = Call

// RUN(DIRECT): lower
// DIRECT-NOT: DirectEval
// DIRECT-NOT: builtin=Eval
// DIRECT-NOT: = StrictEq
// DIRECT-NOT: HasArgumentCount

export function comma(s) {
  return (0, eval)(s);
}

export function member(s) {
  return globalThis.eval(s);
}

export function optional(s) {
  return eval?.(s);
}
