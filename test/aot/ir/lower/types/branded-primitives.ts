// RUN: lower
// CHECK-LABEL: function {{*}}name="castToString"
// CHECK: parameters=[{type=undefined|null|string site=
// CHECK: [[first]]([[name]]: undefined|null|string):
// CHECK: = Convert [[name]] declared={type=undefined|null|string site=
// CHECK-LABEL: function {{*}}name="objectToString"
// CHECK: parameters=[{type=undefined|null|string|L{{*}} site=
// CHECK: [[first]]([[value]]: undefined|null|string|L{{*}}):
// CHECK: = Convert [[value]] declared={type=undefined|null|string site=
// CHECK-LABEL: function {{*}}name="takesNumber"
// CHECK: parameters=[{type=number site=
// CHECK: [[first]]([[id]]: number):

// A brand is a phantom: no value has it when the program runs. An intersection of a primitive with object types is the primitive, and `void & { brand }` is `undefined`. So a branded string is a string and a branded number is a number, and no layout is made for the brand. An object type that stands beside a string in a union is a real object, and it has a layout.
type Escaped = (string & { __escaped: void }) | (void & { __escaped: void }) | "known";
type Id = number & { __tag: "id" };

export function castToString(name: Escaped) {
  return name as string;
}

export function objectToString(value: string | { x: number }) {
  return value as string;
}

export function takesNumber(id: Id) {
  return id;
}
