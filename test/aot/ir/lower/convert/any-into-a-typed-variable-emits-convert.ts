// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="intoNumber"
// CHECK: = Convert {{*}}declared={type={{*}}number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NOT: illTypedCause=
// CHECK: Return
// CHECK-LABEL: function {{*}}name="intoObject"
// CHECK: [[point]] = Convert {{*}}declared={type=undefined|null|L{{*}} site=w{{*}}} illTypedCause=FromLooseType
// CHECK: = PropGet [[point]] key="x"
// CHECK-NOT: illTypedCause=
// CHECK: Return
// CHECK-LABEL: function {{*}}name="sameType"
// CHECK-NOT: illTypedCause=
// CHECK: Return

// RUN(SITES): link
// SITES: typesite {{*}}kind=Variable text="Point"

// The checker lets `any` into every type and no family covers it, so the store into the variable is sent with its cause and the engine tests the value. The type is the whole type of the variable, its layout too, and what is read afterwards is the converted value. A value that already has the type of the variable has no cause.
interface Point {
  x: number;
}

export function intoNumber(value: any) {
  const v: number = value;
  return v;
}

export function intoObject(value: any) {
  const point: Point = value;
  return point.x;
}

export function sameType(value: number) {
  const v: number = value;
  return v;
}
