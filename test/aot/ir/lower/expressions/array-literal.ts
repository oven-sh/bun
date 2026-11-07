// RUN: lower
// CHECK-LABEL: function {{*}}name="annotated"
// CHECK: b0([[element]]: number):
// CHECK: [[literal]] = NewArray [[element]] contents=number
// CHECK-NEXT: = Convert [[literal]] declared={type=undefined|null|Array<number> site=w{{*}}} @
// CHECK-LABEL: function {{*}}name="hole"
// CHECK: b0([[x]]: anything, [[y]]: anything):
// CHECK: = NewArray [[x]], [[y]] contents=anything holes=[1]
// CHECK-LABEL: function {{*}}name="pair"
// CHECK: = NewArray [[x]], [[y]] contents=anything
// CHECK-NOT: holes=

// RUN(NOWHERE): lower
// NOWHERE-NOT: Append

export function annotated(x: number) {
  const a: number[] = [x];
  return a;
}

export function hole(x: any, y: any) {
  return [x, , y];
}

export function pair(x: any, y: any) {
  return [x, y];
}
