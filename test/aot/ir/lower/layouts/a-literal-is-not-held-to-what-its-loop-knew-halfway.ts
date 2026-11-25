// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK-NOT: declared={type=undefined}
// CHECK: = NewObject {{*}}fields=[1, 0]

// At the second check of the literal the loop has seen `last` only as it stands in front of the first turn: undefined. That is no declaration of `prev`.
export function chain(list: { n: number }[]) {
  let last;
  for (const item of list) {
    last = { prev: last, n: item.n };
  }
  return last;
} // @ts-expect-error
console.log(String(chain([{ n: 1 }, { n: 2 }])?.prev?.n));
