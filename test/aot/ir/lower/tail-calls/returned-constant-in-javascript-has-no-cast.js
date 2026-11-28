// RUN: lower
// CHECK-LABEL: function {{*}}name="throughConstant"
// CHECK: [[constantCall]] = Call {{*}}calleeName="g"
// CHECK-NEXT: Return [[constantCall]] @
// CHECK-LABEL: function {{*}}name="written"
// CHECK: [[writtenCall]] = Call {{*}}calleeName="g"
// CHECK-NEXT: ReturnCall [[writtenCall]] @

// Nothing is written of what `g` returns, so a returned call of it has no cast, and its result in a constant no conversion.
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
