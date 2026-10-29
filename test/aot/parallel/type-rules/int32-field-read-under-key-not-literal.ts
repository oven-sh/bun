// Reads int32 fields with brackets. The key is a constant variable, an enum member, one of a few names, or a key of the type.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
  y: int32 = 2;
}
interface Size {
  width: int32;
  height: int32;
}
class Factory {
  get point(): Point {
    return new Point();
  }
}
enum Axis {
  X = "x",
  Y = "y",
}
const enum Side {
  Width = "width",
}

function take(n: int32): int32 {
  return n;
}
function make(): Point {
  return new Point();
}
function readKey(point: Point, key: keyof Point): int32 {
  return point[key];
}
function readGeneric<Key extends keyof Point>(point: Point, key: Key): Point[Key] {
  return point[key];
}
function readEither(size: Size, wide: boolean): int32 {
  const key = wide ? "width" : "height";
  return size[key];
}

const constant = "x";
let literal: "y" = "y";
let either: "x" | "y" = Date.now() > 0 ? "y" : "x";
const point = new Point();
const factory = new Factory();
const size: Size = { width: 3, height: 4 };

console.log(
  take(point[constant]),
  take(make()[constant]),
  take(factory.point[constant]),
  take(new Factory().point[constant]),
);
console.log(take(point[literal]), take(point[either]), take(make()[either]), take(new Factory().point[either]));
console.log(take(point[Axis.X]), take(point[Axis.Y]), take(new Factory().point[Axis.Y]), take(size[Side.Width]));
console.log(readKey(point, "y"), take(readGeneric(point, "x")), readEither(size, true), readEither(size, false));
let sum: int32 = 0;
for (const key of ["x", "y"] as const) sum = (sum + point[key]) | 0;
console.log(sum);

// The value passes through other expressions on its way.
const other = new Point();
const maybe: Point | undefined = Date.now() > 0 ? point : undefined;
class Kept {
  held: int32 = point[either];
  constructor(public given: int32 = other[either]) {}
}
function returned(): int32 {
  return point[either];
}
const arrow = (): int32 => other[either];
function inferred() {
  return point[either];
}
function withDefault(n: int32 = point[either]): int32 {
  return n;
}
function chosen(which: number): int32 {
  switch (which) {
    case 0:
      return point[either];
    default:
      return other[constant];
  }
}
function call(read: () => int32): int32 {
  return read();
}
function* each(): Generator<int32> {
  yield point[either];
}
const kept = point[either];
let changed = point[either];
changed = other[constant];
const { [either]: taken } = point;
other.x = point[either];
other[either] = point[constant];
const made: Size = { width: point[either], height: other[Axis.X] };

console.log(
  take(Date.now() > 0 ? point[either] : other[either]),
  take(maybe?.[either] ?? 0),
  take(maybe?.[either] ?? other[either]),
);
console.log(
  take(point[either] || other[either]),
  take(point[either]!),
  take(point[either] satisfies int32),
  take(point[either] as int32),
);
console.log(take((take(0), point[either])), returned(), arrow(), take(inferred()), withDefault(), chosen(0), chosen(1));
console.log(
  call(() => point[either]),
  [...each()].join(),
  take(kept),
  take(changed),
  take(taken),
  other.x,
  other.y,
);
console.log(
  made.width,
  made.height,
  new Kept().held,
  new Kept().given,
  take(point[either] | 0),
  take((point[either] + other[either]) | 0),
);
