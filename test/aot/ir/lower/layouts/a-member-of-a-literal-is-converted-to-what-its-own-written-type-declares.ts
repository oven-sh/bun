// RUN: link
// CHECK: layout [[record]] {{*}}fields=[{key="id" {{*}}{key="kind" declared={type=undefined|null|"first"|"second"|"third" flags=[IsExpected, OmitsNull, OmitsUndefined]} flags=[IsRequired]}]
// CHECK: function {{*}}name="make"
// CHECK: = Convert {{*}}declared={type=undefined|null|"second" flags=[OmitsNull, OmitsUndefined]}
// CHECK: = Convert {{*}}declared={type=undefined|null|"first" flags=[OmitsNull, OmitsUndefined]}
// CHECK: = Convert {{*}}declared={type=undefined|null|"third" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NOT: = Convert {{*}}"first"|"second"

// The three types have the same names, so they are one record, and its field holds what any of them declares. A literal is held to the type that it is written under: not to
// the union of those that the file has met by then, which follows the order of the text and is one type more for each literal.
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

export function make(seed: number): number {
  const second: Second = { kind: "second", id: seed };
  const first: First = { kind: "first", id: seed + 1 };
  const third: Third = { kind: "third", id: seed + 2 };
  return weigh(second) + weigh(first) + weigh(third);
}
console.log(make(1));
