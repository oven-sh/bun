// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet {{*}}key="a"
// CHECK-NEXT: [[converted]] = Convert [[read]] declared={type=undefined|number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: [[returned]] = Convert [[converted]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]

export function f(r: { [key: string]: number }) {
  return r.a;
}
