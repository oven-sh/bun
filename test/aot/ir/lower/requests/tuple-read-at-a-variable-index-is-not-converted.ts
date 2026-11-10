// RUN: lower
// CHECK-LABEL: function {{*}}name="ofConstants"
// CHECK-NOT: Convert
// CHECK: [[size]] = ElemGet [[sizes]],
// CHECK-NEXT: Return [[size]]
// CHECK-LABEL: function {{*}}name="ofTwoKinds"
// CHECK-NOT: Convert
// CHECK: [[element]] = ElemGet [[pair]],
// CHECK-NEXT: Return [[element]]

// A read of an element of a tuple is converted to nothing, whatever the checker knows about what the tuple holds.
const sizes = [1, 2, 4] as const;

export function ofConstants(i: number) {
  return sizes[i % 3];
}

export function ofTwoKinds(pair: [number, string], i: number) {
  return pair[i];
}
