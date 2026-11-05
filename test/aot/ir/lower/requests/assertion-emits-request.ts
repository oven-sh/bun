// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[cast]] = Convert {{*}}declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[cast]]

// RUN(SITES): link
// SITES: typesite [[site]] {{*}}kind=Assertion text="string"
// SITES: function {{*}}name="f"
// SITES: = Convert {{*}}declared={type=undefined|null|string site=[[site]] flags=[OmitsNull, OmitsUndefined]}

export function f(x: any) {
  return x as string;
}
