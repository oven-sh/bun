// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: ElemSet {{*}}, [[converted]]

// RUN(SITES): link
// SITES: typesite [[site]] {{*}}kind=Element text="number"
// SITES: function {{*}}name="f"
// SITES: = Convert {{*}}declared={type=number site=[[site]]}

export function f(a: number[], v: any) {
  a[0] = v;
}
