// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK: [[item]] = ElemGet [[xs]], [[i]]
// CHECK-NEXT: [[convertedItem]] = Convert [[item]] declared={type=number site=w{{*}}} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return [[convertedItem]]
// CHECK-LABEL: function {{*}}name="field"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK: [[x]] = PropGet [[p]] key="x"
// CHECK-NEXT: [[returned]] = Convert [[x]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]
// CHECK-LABEL: function {{*}}name="store"
// CHECK-NEXT: ([[target]]: {{*}}, [[v]]:
// CHECK: [[converted]] = Convert [[v]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet [[target]], [[converted]] key="x"
// CHECK-LABEL: function {{*}}name="untyped"
// CHECK-NEXT: ([[typed]]:
// CHECK: [[receiver]] = Convert [[typed]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[read]] = PropGet [[receiver]] key="x"
// CHECK-NEXT: Return [[read]]

// An array does not say what it holds, so an element that is read is converted to the element type. The slot of a field holds what the field's type says, so a field that is read is not converted: the only conversion in `field` is the one to the result of the function. What is stored in a field is converted to the field's type. A member of `any` has no type to be converted to.
interface P {
  x: number;
}

export function element(xs: number[], i: number) {
  return xs[i];
}

export function field(p: P) {
  return p.x;
}

export function store(p: P, v: any) {
  p.x = v;
}

export function untyped(p: P) {
  return (p as any).x;
}
