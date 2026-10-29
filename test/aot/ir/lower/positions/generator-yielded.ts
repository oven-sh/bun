// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[converted]]

export function* f(x: any): Generator<number> {
  yield x;
}
