// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: [[call]] = Call [[callee]] calleeName="g"
// CHECK-NOT: Convert
// CHECK: Return [[call]]
// CHECK-LABEL: function {{*}}name="tail"
// CHECK: [[last]] = Call
// CHECK-NEXT: ReturnCall [[last]] @

// `g` is in the program, so the engine sees what it returns: the result of a call of it is converted to nothing, and a returned call of it has no cast.
// What a declaration without a body answers is converted (../calls/call-result-claim.ts).
function g(): number {
  return 1;
}

export function f() {
  const v = g();
  g();
  return v;
}

export function tail() {
  return g();
}
