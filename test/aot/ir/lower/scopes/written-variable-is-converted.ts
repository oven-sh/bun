// RUN: lower
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK-NOT: Convert
// CHECK: Return [[inferredValue]]
// CHECK-LABEL: function {{*}}name="written"
// CHECK: [[result]] = Call {{*}}calleeName="g"
// CHECK-NEXT: [[n]] = Convert [[result]] declared={type=number} @
// CHECK: Return [[n]]

declare function g(): any;

export function inferred() {
  let n = g();
  g();
  return n;
}

export function written() {
  let n: number = g();
  g();
  return n;
}
