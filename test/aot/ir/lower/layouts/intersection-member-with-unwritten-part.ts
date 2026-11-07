// RUN: link
// CHECK: layout [[half]] fields=[{key="id" declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} {{*}}key="own" declared={type=number} {{*}}key="rows" declared={type=undefined|null|string|Array<undefined|null|[[row]]> flags=[OmitsNull, OmitsUndefined]}
// CHECK: function {{*}}name="half" {{*}}parameters=[{type=undefined|null|[[half]] site=

// RUN(WRITTEN): link
// WRITTEN: layout [[both]] fields=[{key="id" declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} {{*}}key="own" declared={type=number} {{*}}key="rows" declared={type=undefined|null|string|Array<undefined|null|[[row]]> flags=[OmitsNull, OmitsUndefined]} flags=
// WRITTEN: function {{*}}name="both" {{*}}parameters=[{type=undefined|null|[[both]] site=

// A member that several parts of an intersection declare has the intersection of their types, and `{ brand: true } & string` is a string. So the field has the checker's type of the member, never the type that one part declares. `{ n: number }[] & { n: number }` is an array, whoever declares the other part.
/// <reference path="./imports/outside.d.ts" />
interface A {
  id: { brand: true };
  rows: { n: number }[];
  own: number;
}

interface B {
  id: string;
  rows: string | { n: number };
}

export function half(value: A & Outside) {
  return value;
}

export function both(value: A & B) {
  return value;
}

export function take(value: unknown) {
  return [half(value as A & Outside), both(value as A & B)];
}
