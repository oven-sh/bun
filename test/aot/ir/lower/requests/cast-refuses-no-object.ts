// RUN: lower
// CHECK-LABEL: function {{*}}name="anyToArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="arrayOrStringToString"
// CHECK: = Convert {{*}}declared={type=undefined|null|string site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="arrayToArray"
// CHECK: [[anyArray]] = Convert {{*}}declared={type=undefined|null|Array site=w{{*}}} @
// CHECK-NEXT: = Convert [[anyArray]] declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="concatToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|number|string> site=w{{*}}}}, {declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}}}, {declared=
// CHECK-LABEL: function {{*}}name="filterToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}}}, {declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}}}, {declared=
// CHECK-LABEL: function {{*}}name="fromObjectOrString"
// CHECK: = Convert {{*}}declared={type=undefined|null|string site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="fromString"
// CHECK: = Convert {{*}}declared={type=undefined|null|"a"|"b" site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="fromUnknown"
// CHECK: = Convert {{*}}declared={type=undefined|null|boolean|number|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="functionToFunction"
// CHECK: results=[{type=undefined|null|[[takesCount]] site=w{{*}}}]
// CHECK: = Convert {{*}}declared={type=undefined|null|[[takesCount]] site=w{{*}}} @
// CHECK-LABEL: function {{*}}name="mapToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|number|string> site=w{{*}}}}, {declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}}}, {declared=
// CHECK-LABEL: function {{*}}name="sliceToArray"
// CHECK: [[slice]] = Convert {{*}}declared={type=undefined|null|Array<undefined|null|number|string> site=w{{*}}}
// CHECK-NEXT: = Convert [[slice]] declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="throughUnknown"
// CHECK: = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="toArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="toFunctionType"
// CHECK: results=[{type=undefined|null|[[takesNothing]] site=w{{*}}}]
// CHECK: = Convert {{*}}declared={type=undefined|null|[[takesNothing]] site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="typeParameterToArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> site=w{{*}}} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="viewToFloat64Array"
// CHECK: = Convert {{*}}declared={type=undefined|null|Float64Array site=w{{*}}} illTypedCause=Assertion

// RUN(NEVER): lower
// NEVER-LABEL: function {{*}}name="throughNever"
// NEVER: = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=
// NEVER-LABEL: function {{*}}name="throughUnknown"

// RUN(TAIL): lower
// TAIL-LABEL: function {{*}}name="tailCall"
// TAIL: ReturnCall {{*}}casts=[{declared={type=number site=w{{*}}}}, {declared={type=number site=w{{*}}}}]

// An assertion converts its operand to the asserted type, and to nothing wider: no kind of object is added for what the operand may be. The cause says how the checker's type of the operand stands to the asserted type. There is none where the operand is assignable to it: an array to `unknown[]`, a function to a function type that takes more. It is `Assertion` where the assertion goes down or sideways. It is `FromLooseType` where the operand says nothing about its value: `any`, `unknown`, a bare type parameter. `never` says nothing either: the checker assigns it to every type, and the value behind `as never` is still the string. In a tail call the asserted type is one of the casts, between the type of the call's result and the type that the function returns.
type Attribute = boolean | string | number;

declare function make(): unknown;

export function anyToArray(value: any) {
  return value as string[];
}

export function arrayOrStringToString(value: string | number[]) {
  return value as string;
}

export function arrayToArray(value: number[]) {
  return value as unknown[] as string[];
}

export function concatToArray(value: (string | number)[]) {
  return value.concat(value) as string[];
}

export function filterToArray(value: (string | number)[]) {
  return value.filter(item => typeof item === "string") as string[];
}

export function functionToFunction(value: () => void) {
  return value as (count: number) => void;
}

export function mapToArray(value: number[]) {
  return value.map(item => (item > 0 ? String(item) : item)) as string[];
}

export function sliceToArray(value: (string | number)[]) {
  const part = value.slice(0, 1) as string[];
  return part.length;
}

export function typeParameterToArray<T>(value: T) {
  return value as string[];
}

export function viewToFloat64Array(value: unknown) {
  return ArrayBuffer.isView(value) ? (value as Float64Array) : undefined;
}

export function fromObjectOrString(value: string | { x: number }) {
  return value as string;
}

export function fromString(value: string) {
  return value as "a" | "b";
}

export function fromUnknown(value: unknown) {
  return value as Attribute;
}

export function throughNever(value: string) {
  return value as never as number;
}

export function throughUnknown(value: string) {
  return value as unknown as number;
}

export function toArray(value: unknown) {
  return value as string[];
}

export function toFunctionType(value: unknown) {
  return value as () => void;
}

export function tailCall() {
  return make() as number;
}
