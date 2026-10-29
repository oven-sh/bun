// RUN: lower
// CHECK-LABEL: function {{*}}name="atConstant"
// CHECK: [[first]] = ElemGet [[array]],
// CHECK-NEXT: [[convertedFirst]] = Convert [[first]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return [[convertedFirst]]
// CHECK-LABEL: function {{*}}name="atVariable"
// CHECK: [[element]] = ElemGet [[elements]],
// CHECK-NEXT: [[convertedElement]] = Convert [[element]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return [[convertedElement]]

export function atConstant(a: number[]) {
  return a[0];
}

export function atVariable(a: number[], i: number) {
  return a[i];
}
