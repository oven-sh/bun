// RUN: link
// CHECK: function {{*}}name="make"
// CHECK: = Convert {{*}}declared={type=undefined|null|"first" flags=[OmitsNull, OmitsUndefined]}
// CHECK: = Convert {{*}}declared={type=undefined|null|"third" flags=[OmitsNull, OmitsUndefined]}
// CHECK: = Convert {{*}}declared={type=undefined|null|"second" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NOT: = Convert {{*}}"first"|"

// a-member-of-a-literal-is-converted-to-what-its-own-written-type-declares.ts with the literals in another order, and all three types met in front of the first of them: each literal is held to the same type as there.
interface First {
  kind: "first";
  id: number;
}
interface Second {
  kind: "second";
  id: number;
}
interface Third {
  kind: "third";
  id: number;
}

function weigh(item: First | Second | Third): number {
  return item.kind.length + item.id;
}

export function make(seed: number, kept: First | Second | Third | undefined): number {
  const first: First = { kind: "first", id: seed + 1 };
  const third: Third = { kind: "third", id: seed + 2 };
  const second: Second = { kind: "second", id: seed };
  return weigh(second) + weigh(first) + weigh(third) + (kept ? weigh(kept) : 0);
}
console.log(make(1, undefined));
