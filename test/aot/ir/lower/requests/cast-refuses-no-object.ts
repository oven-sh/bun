// RUN: lower
// CHECK-LABEL: function {{*}}name="anyToArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="arrayOrStringToString"
// CHECK: = Convert {{*}}declared={type=undefined|null|string flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="arrayToArray"
// CHECK: [[anyArray]] = Convert {{*}}declared={type=undefined|null|Array flags={{*}}} illTypedCause=Assertion
// CHECK-NEXT: = Convert [[anyArray]] declared={type=undefined|null|Array<undefined|null|string> flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="concatToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-LABEL: function {{*}}name="filterToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-LABEL: function {{*}}name="fromObjectOrString"
// CHECK: = Convert {{*}}declared={type=undefined|null|string flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="fromString"
// CHECK: = Convert {{*}}declared={type=undefined|null|"a"|"b" flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="fromUnknown"
// CHECK: = Convert {{*}}declared={type=undefined|null|boolean|number|string flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="functionToFunction"
// CHECK: = Convert {{*}}declared={type=undefined|null|[[takesCount]] flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="mapToArray"
// CHECK: ReturnCall {{*}}casts=[{declared={type=undefined|null|Array<undefined|null|number|string> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-LABEL: function {{*}}name="sliceToArray"
// CHECK: [[slice]] = Convert {{*}}declared={type=undefined|null|Array<undefined|null|number|string> flags={{*}}}
// CHECK-NEXT: = Convert [[slice]] declared={type=undefined|null|Array<undefined|null|string> flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="throughUnknown"
// CHECK: = Convert {{*}}declared={type=number} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="toArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="toFunctionType"
// CHECK: = Convert {{*}}declared={type=undefined|null|[[takesNothing]] flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="typeParameterToArray"
// CHECK: = Convert {{*}}declared={type=undefined|null|Array<undefined|null|string> flags={{*}}} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="viewToFloat64Array"
// CHECK: = Convert {{*}}declared={type=undefined|null|Float64Array flags={{*}}} illTypedCause=Assertion
// CHECK: function [[takesCount]] {{*}}role=Signature
// CHECK: function [[takesNothing]] {{*}}role=Signature

// RUN(NEVER): lower
// NEVER-LABEL: function {{*}}name="throughNever"
// NEVER: = Convert {{*}}declared={type=number} illTypedCause=
// NEVER-LABEL: function {{*}}name="throughUnknown"

// RUN(TAIL): lower
// TAIL-LABEL: function {{*}}name="tailCall"
// TAIL: ReturnCall {{*}}casts=[{declared={type=number}}]

// An assertion converts its operand to the asserted type, and to nothing wider: no kind of object is added for what the operand may be. Nobody asks for the type of the operand, so the cause is `Assertion` whatever the operand is: `any`, `unknown`, a bare type parameter, a type that is assignable to the asserted one, a type that is not. `as unknown` and `as never` convert to nothing, and the value behind them is still the string. In a tail call the asserted type is a cast behind the type of the call's result. The result of a function without an annotation adds none.
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
