// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet {{*}}, [[converted]] key="x"

// RUN(SITES): link
// SITES: typesite [[site]] {{*}}kind=Field text="number"
// SITES: function {{*}}name="f"
// SITES: = Convert {{*}}declared={type=number site=[[site]]}

export function f(p: { x: number }, v: any) {
  p.x = v;
}
