// RUN: lower
// CHECK-LABEL: function {{*}}name="intoNumber"
// CHECK: = Convert {{*}}declared={type={{*}}number} @
// CHECK-NOT: illTypedCause=
// CHECK: Return
// CHECK-LABEL: function {{*}}name="intoObject"
// CHECK: [[point]] = Convert {{*}}declared={type=undefined|null|L{{*}}} @
// CHECK: = PropGet [[point]] key="x"
// CHECK-NOT: illTypedCause=
// CHECK: Return
// CHECK-LABEL: function {{*}}name="sameType"
// CHECK-NOT: illTypedCause=
// CHECK: Return

// A variable with a written type converts what is stored into it, `any` like a value that already has the type. Nobody asks what type flows in, so no such conversion has a cause. The type is the whole type of the variable, its layout too, and what is read afterwards is the converted value.
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
