// RUN: lower
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK-NOT: Convert
// CHECK: Return
// CHECK-LABEL: function {{*}}name="written"
// CHECK: [[result]] = Call {{*}}calleeName="g"
// CHECK-NEXT: [[expected]] = Convert [[result]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[n]] = Convert [[expected]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[n]]

declare function g(): any;

export function inferred() {
  let n = g();
  return n;
}

export function written() {
  let n: number = g();
  return n;
}
