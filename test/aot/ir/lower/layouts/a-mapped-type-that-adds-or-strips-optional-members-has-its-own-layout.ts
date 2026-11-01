// RUN: link
// CHECK: layout [[whole]] name="Whole" {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="b" declared={type=undefined|number}}]
// CHECK: layout [[none]] name="Loose<Whole>" {{*}}fields=[{key="a" declared={type=undefined|number}}, {key="b" declared={type=undefined|number}}]
// CHECK: layout [[required]] name="Required<Partly>" {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="b" declared={type=number} flags=[IsRequired]}]
// CHECK: function {{*}}name="all" {{*}}parameters=[{type=undefined|null|[[whole]] site=w{{*}}}, {type=undefined|null|[[whole]] site=w{{*}}}, {type=undefined|null|[[whole]] site=w{{*}}}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string|symbol|bigint|[[none]] flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=undefined|null|[[required]] site=w{{*}}},

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
