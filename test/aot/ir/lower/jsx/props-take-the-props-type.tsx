// RUN: link
// CHECK: layout [[props]] {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="children"
// CHECK: function {{*}}name="render"
// CHECK-NEXT: ({{*}}[[v]]: anything):
// CHECK: [[converted]] = Convert [[v]] declared={type=number} illTypedCause=FromLooseType
// CHECK: = NewObject -, [[converted]], {{*}}layout=[[props]] fields=[0, 1]

function C(p: { a: number; children?: any }) {
  return null;
}

export function render(v: any) {
  return <C a={v}>x</C>;
}
