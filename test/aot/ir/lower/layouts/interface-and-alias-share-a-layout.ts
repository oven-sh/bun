// RUN: link
// CHECK: layout [[i]] module=[[entry]] {{*}}fields=[{key="a" declared={type=number} flags=[{{*}}]}] flags=[IsNeverAllocated]
// CHECK-NOT: layout {{*}}module=[[entry]]
// CHECK: function {{*}}name="both" {{*}}parameters=[{type=undefined|null|[[i]] flags={{*}}}, {type=undefined|null|[[i]] flags={{*}}}]

// The layout is named after the first type the file meets.
interface I {
  a: number;
}

type T = { a: number };

export function both(i: I, t: T) {
  return [i, t];
}
