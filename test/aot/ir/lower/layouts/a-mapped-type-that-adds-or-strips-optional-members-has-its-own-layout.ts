// RUN: link
// CHECK: layout [[whole]] {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="b" declared={type=undefined|number}}]
// CHECK: layout [[required]] {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="b" declared={type=number} flags=[IsRequired]}]
// CHECK: layout [[none]] {{*}}fields=[{key="a" declared={type=undefined|number}}, {key="b" declared={type=undefined|number}}]
// CHECK: function {{*}}name="all" {{*}}parameters=[{type=undefined|null|[[whole]] flags={{*}}}, {type=undefined|null|[[whole]] flags={{*}}}, {type=undefined|null|[[whole]] flags={{*}}}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|[[required]] flags={{*}}},

interface Whole {
  a: number;
  b: number;
}

interface Partly {
  a: number;
  b?: number;
}

type Loose<T> = { [K in keyof T]?: T[K] };
type Same<T> = { [K in keyof T]: T[K] };

export function all(
  whole: Whole,
  partly: Partly,
  same: Same<Whole>,
  none: Partial<Whole>,
  loose: Loose<Whole>,
  fixed: Readonly<Partial<Whole>>,
  noneOfPartly: Partial<Partly>,
  required: Required<Partly>,
  wholeAndMore: Whole & { c: number },
  noneAndMore: Partial<Whole> & { c: number },
) {
  return [whole, partly, same, none, loose, fixed, noneOfPartly, required, wholeAndMore, noneAndMore];
}

export function make(): [Whole, Partial<Whole>, Required<Partly>] {
  return [{ a: 1, b: 2 }, { b: 2 }, { a: 1, b: 2 }];
}
