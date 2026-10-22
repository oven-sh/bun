// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[call]] = Call [[callee]] calleeName="g"
// CHECK-NEXT: [[converted]] = Convert [[call]] declared={type=number site=w{{*}}} @
// CHECK-NEXT: Return [[converted]]
// CHECK-LABEL: function {{*}}name="tail"
// CHECK: [[last]] = Call
// CHECK-NEXT: ReturnCall [[last]] casts=[{declared={type=number site=w{{*}}}}

function g(): number {
  return 1;
}

export function f() {
  const v = g();
  return v;
}

export function tail() {
  return g();
}
