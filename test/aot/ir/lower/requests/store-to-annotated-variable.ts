// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[stored]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[stored]]

export function f(x: any) {
  const v: number = x;
  return v;
}
