// The literal further down has the names of Point and holds a fraction. It is never taken for a Point, so the `x` of a Point is still an int32, wherever in the file the read stands.
import type { int32 } from "bun";
interface Point {
  x: int32;
  y: int32;
}
function readAbove(point: Point): int32 {
  return point.x;
}
function half(n: number): number {
  const local = { x: n / 2, y: 2 };
  return local.x + local.y;
}
function readBelow(point: Point): int32 {
  return point.y;
}
console.log(readAbove({ x: 1, y: 2 }), half(2.5), readBelow({ x: 3, y: 4 }));
