// RUN: link
// CHECK: layout [[one]] name="Leaf" module=[[entry]] {{*}}fields=[{key="kind" declared={type=undefined|null|"alias"|"box"|"leaf"|"reordered" flags=[OmitsNull, OmitsUndefined]} flags=[{{*}}]}, {key="value" declared={type=undefined|null|number|string} flags=[{{*}}]}]
// CHECK: layout [[other]] name="Longer" module=[[entry]]
// CHECK-NOT: layout {{*}}module=[[entry]]
// CHECK: function {{*}}name="all" {{*}}parameters=[{type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}, {type=undefined|null|[[one]] site=w{{*}}}]
// CHECK: function {{*}}name="more" {{*}}parameters=[{type=undefined|null|[[other]] site=

// RUN(READ): lower
// READ-LABEL: function {{*}}name="read"
// READ: [[value]] = PropGet {{*}}key="value"
// READ: [[number]] = Convert [[value]] declared={type=number site=w{{*}}}
// READ: Return [[number]]

// A layout is keyed by the set of property names and nothing else: not the kind of declaration, the order of the members, `readonly`, a type argument,
// or the literal type of a member. It is named after the first type the file meets, and each field's type is the union of what those types declare.
// A read through a type that declares less than the union is tested. One more name makes another layout.
interface Leaf {
  kind: "leaf";
  value: number;
}

type Alias = { kind: "alias"; value: number };

interface Reordered {
  value: number;
  kind: "reordered";
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Box<T> {
  kind: "box";
  value: T;
}

interface Longer {
  kind: "longer";
  value: number;
  more: number;
}

export function all(
  leaf: Leaf,
  alias: Alias,
  reordered: Reordered,
  mutable: Mutable<Leaf>,
  frozen: Readonly<Leaf>,
  numbers: Box<number>,
  strings: Box<string>,
) {
  return [leaf, alias, reordered, mutable, frozen, numbers, strings];
}

export function more(longer: Longer) {
  return longer;
}

export function read(leaf: Leaf) {
  return leaf.value;
}
