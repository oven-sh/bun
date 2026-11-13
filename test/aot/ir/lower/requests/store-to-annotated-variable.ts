// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[x]]: anything):
// CHECK-NOT: Convert
// CHECK: [[stored]] = Convert [[x]] declared={type=number} @
// CHECK-NEXT: Return [[stored]]

// What is stored to an annotated variable is converted to the type that is written, once. The conversion names no cause: nobody asks for the type of the value.
export function f(x: any) {
  const v: number = x;
  return v;
}
