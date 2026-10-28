// RUN: lower
// CHECK-LABEL: function {{*}}name="ofConstants"
// CHECK: [[size]] = ElemGet [[sizes]],
// CHECK-NEXT: [[convertedSize]] = Convert [[size]] declared={type=int[1, 4] site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-LABEL: function {{*}}name="ofTwoKinds"
// CHECK: [[element]] = ElemGet [[pair]],
// CHECK-NEXT: [[convertedElement]] = Convert [[element]] declared={type=undefined|null|number|string site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return [[convertedElement]]

const sizes = [1, 2, 4] as const;

export function ofConstants(i: number) {
  return sizes[i % 3];
}

export function ofTwoKinds(pair: [number, string], i: number) {
  return pair[i];
}
