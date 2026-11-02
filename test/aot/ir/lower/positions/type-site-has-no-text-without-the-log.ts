// RUN: link
// CHECK-NOT: kind=Parameter text=
// CHECK: typesite [[site]] module=[[entry]] {{*}}kind=Parameter
// CHECK-NOT: kind=Result text=
// CHECK: function {{*}}name="double" module=[[entry]] {{*}}parameters=[{type=number site=[[site]]}]

// Only the log of type mismatches prints the text of a type, so no other build makes it or carries it.

export function double(value: number): number {
  return value * 2;
}
