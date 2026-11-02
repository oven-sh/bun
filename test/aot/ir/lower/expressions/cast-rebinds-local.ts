// RUN: lower
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: = Convert {{*}}declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK: [[read]] = GetEnvironmentField
// CHECK-NEXT: Return [[read]]
// CHECK-LABEL: function {{*}}name="local"
// CHECK: b0([[x]]: anything):
// CHECK: [[converted]] = Convert [[x]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK: Return [[converted]]

export function captured(x: unknown, use: any): unknown {
  use(() => {
    x = 1;
  });
  (x as string).length;
  return x;
}

export function local(x: unknown): unknown {
  (x as string).length;
  return x;
}
