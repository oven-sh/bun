// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[call]] = Call
// CHECK-NEXT: [[converted]] = Convert [[call]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[converted]]

function id<T>(x: T): T {
  return x;
}

export function f(y: number) {
  const v = id(y);
  return v;
}
