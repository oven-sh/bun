// A position asks for the proof where whatever number it holds is an int32. `int32 | 0.5` holds a number that is none, however that number is spelled: its type is `number`, and a promise on
// such a position is one that the verifier of the program refuses.
// RUN: lower
// CHECK-LABEL: function {{*}}name="beside_a_half"{{*}}parameters=[{type=number}]
// CHECK-LABEL: function {{*}}name="beside_a_large_integer"
// CHECK-NOT: IsInt32Promise
// CHECK-LABEL: function {{*}}name="beside_a_text"{{*}}parameters=[{type={{*}}i32|"none" flags=[IsInt32Promise
// CHECK-LABEL: function {{*}}name="beside_an_alias_of_a_half"{{*}}parameters=[{type=number}]
// CHECK-LABEL: function {{*}}name="beside_an_enum_with_a_half"{{*}}parameters=[{type=number}]
// CHECK-LABEL: function {{*}}name="beside_seven"{{*}}parameters=[{type=i32 flags=[IsInt32Promise]}]

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

enum Step {
  Half = 0.5,
  One = 1,
}
type Half = 0.5;

export function beside_a_half(step: int32 | 0.5) {
  return step;
}
export function beside_a_large_integer(step: int32 | 4294967296) {
  return step;
}
export function beside_an_enum_with_a_half(step: int32 | Step) {
  return step;
}
export function beside_an_alias_of_a_half(step: int32 | Half) {
  return step;
}
export function beside_seven(step: int32 | 7) {
  return step;
}
export function beside_a_text(step: int32 | "none") {
  return step;
}
