// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|string site=w{{*}}}]
// CHECK: ([[x]]: undefined|null|string):
// CHECK-NOT: Convert
// CHECK: [[returned]] = Convert [[x]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=Assertion @
// CHECK-NEXT: Return [[returned]]

// `x!` emits nothing. The only `Convert` is the one to the type of the result, which lists `undefined` and `null` like every type that
// holds a reference.

export function f(x: string | undefined) {
  return x!;
}
