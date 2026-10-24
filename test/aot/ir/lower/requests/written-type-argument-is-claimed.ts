// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[call]] = Call
// CHECK-NEXT: [[converted]] = Convert [[call]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[converted]]

// RUN(SITES): link
// SITES: typesite {{*}}kind=Result text="T"
// SITES-NEXT: typesite [[site]] {{*}}kind=CallResult
// SITES: function {{*}}name="f"
// SITES: = Convert {{*}}declared={type=number site=[[site]]} illTypedCause=FromLooseType

function id<T>(x: T): T {
  return x;
}

export function f(z: any) {
  const v = id<number>(z);
  return v;
}
