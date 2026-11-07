// RUN: link
// CHECK: layout {{*}}name="Alone" {{*}}supertypes=[

// RUN(PICKED): link
// PICKED-NOT: layout {{*}}name="Opaque"{{*}}supertypes=
// PICKED-NOT: layout {{*}}name="Leaf"{{*}}supertypes=
// PICKED-NOT: layout {{*}}name="Root"{{*}}supertypes=

// `value as Leaf` with `value: Leaf | Opaque` picks the Leaf among the objects that the union names, and says nothing of an Opaque. A type whose members are all
// optional can be cast to any object type, and any object type to it: if each member of the union counted that could be cast alone, one such type in the unions of a
// program would put every type that stands beside it into the family of every other. Cast by itself, it does go below the target.
interface Opaque {
  readonly mark?: never;
}

interface Alone {
  readonly sign?: never;
}

interface Leaf {
  size: number;
}

interface Root {
  name: string;
}

export function sizeOf(value: Leaf | Opaque | null): number {
  return (value as Leaf).size;
}

export function nameOf(value: Root | Opaque): string {
  return (value as Root).name;
}

export function hide(value: Leaf | Root | Opaque): Opaque {
  return value as Opaque;
}

export function force(value: Alone): Leaf {
  return value as Leaf;
}
