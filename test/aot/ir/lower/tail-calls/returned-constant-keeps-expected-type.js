// RUN: lower
// CHECK-LABEL: function {{*}}name="throughConstant"
// CHECK: [[constantCall]] = Call {{*}}calleeName="g"
// CHECK-NEXT: ReturnCall [[constantCall]] casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-LABEL: function {{*}}name="written"
// CHECK: [[writtenCall]] = Call {{*}}calleeName="g"
// CHECK-NEXT: ReturnCall [[writtenCall]] casts=[{declared={type=number flags=[IsExpected]}}]

function g() {
  return 1;
}

export function throughConstant() {
  const v = g();
  return v;
}

export function written() {
  return g();
}
