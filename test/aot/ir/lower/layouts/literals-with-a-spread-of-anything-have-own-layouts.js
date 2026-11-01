// RUN: lower
// The names of `{ a: 1, ...anything }` are not known where it is written: they are those of what is spread and what is stored later,
// which differ from one literal to the next. So each such literal has a layout of its own, as an empty one has.
// CHECK-LABEL: function {{*}}name="first"
// CHECK: = NewObject layout=[[first]]
// CHECK-LABEL: function {{*}}name="second"
// CHECK-NOT: = NewObject layout=[[first]]
// CHECK: = NewObject layout=
// A literal that begins with such a spread has no layout of its own: it is born as a copy of what it spreads.
// CHECK-LABEL: function {{*}}name="third"
// CHECK-NOT: NewObject
// CHECK: [[copy]] = CopyObject [[options]] @
// CHECK-NEXT: CopyDataProperties [[copy]], [[more]] @
// CHECK-NEXT: Return [[copy]]
export function first(options) {
  return { delay: 50, ...options, mode: options.mode ?? "fuzzy" };
}
export function second(options, more) {
  return { delay: 50, ...options, mode: more };
}
export function third(options, more) {
  return { ...options, ...more };
}
