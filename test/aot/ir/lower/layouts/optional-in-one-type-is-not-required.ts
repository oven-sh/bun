// RUN: link
// CHECK: layout [[both]] name="Whole" {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}, {key="b" declared={type=undefined|number}}]
// CHECK: function {{*}}name="both" {{*}}parameters=[{type=undefined|null|[[both]] site=w{{*}}}, {type=undefined|null|[[both]] site=w{{*}}}]

// Optional or required is not part of a layout's key. An object of either type can have the layout, so a field is required only if every type with the
// layout requires it.
interface Whole {
  a: number;
  b: number;
}

interface Partly {
  a: number;
  b?: number;
}

export function both(whole: Whole, partly: Partly) {
  return [whole, partly];
}

// A name that nothing writes is required of no object.
export function make(): Whole {
  return { a: 1, b: 2 };
}
