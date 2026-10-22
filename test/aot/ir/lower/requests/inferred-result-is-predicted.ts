// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[call]] = Call
// CHECK-NEXT: [[converted]] = Convert [[call]] declared={type=number site=w{{*}}} @
// CHECK-NEXT: Return [[converted]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: results=[{type=number site=w{{*}}}]

function g() {
  return 1;
}

export function f() {
  const v = g();
  return v;
}
