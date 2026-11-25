// RUN: lower
// The length of a text that a constant holds is a number in the wire. Behind the declaration nothing else of the name is left there.
// A function may be called in front of the declaration, so there the name still runs for its check.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: key="length"
// CHECK: = Integer integer=9
// CHECK-LABEL: function {{*}}name="inside"
// CHECK-NOT: key="length"
// CHECK: = Integer integer=9

export const held = "nine long";
export const length = held.length + process.argv.length;
export function inside() {
  return held.length;
}
