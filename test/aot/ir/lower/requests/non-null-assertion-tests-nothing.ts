// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: results=[{type=undefined|null|string site=[[assertedResult]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: b0([[value]]: {{*}}):
// CHECK-NOT: Convert
// CHECK: [[returned]] = Convert [[value]] declared={type=undefined|null|string site=[[assertedResult]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion @
// CHECK-NEXT: Return [[returned]]
// CHECK-LABEL: function {{*}}name="nothingElse"
// CHECK: results=[{type=undefined|null|string site=[[writtenResult]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK-NOT: never
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: [[result]] = Convert [[nothing]] declared={type=undefined|null|string site=[[writtenResult]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion @
// CHECK-NEXT: Return [[result]]
// CHECK-NOT: never
// CHECK-LABEL: function {{*}}name="unknownValue"
// CHECK: b0([[unknown]]: anything):
// CHECK-NOT: Convert
// CHECK: Return [[unknown]]

// RUN(TAIL): lower
// TAIL-LABEL: function {{*}}name="tailCall"
// TAIL: ReturnCall

// `x!` converts nothing: the value passes unchanged, `undefined` and `null` too. The only conversion in `asserted` and in `nothingElse` is the one to the result of the function, whose type takes them. It says that it rests on an assertion: the checker has not shown that the value is there. A call under `!` is still a tail call.
declare function make(): string | undefined;

export function asserted(value: string | undefined) {
  return value!;
}

export function nothingElse(): string {
  return undefined!;
}

export function tailCall() {
  return make()!;
}

export function unknownValue(value: unknown) {
  return value!;
}
