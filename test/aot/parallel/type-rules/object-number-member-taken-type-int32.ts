// An object whose `x` is a number is assignable to Point for TypeScript. The build follows no object from one type to another: a read of `point.x` claims the int32 that Point declares,
// compiled code tests it, and a fraction comes out as it does under `bun run`, whether the read stands above or below the place where the object is taken for a Point.
import type { int32 } from "bun";
interface Point {
  x: int32;
  y: int32;
}
function xOf(point: Point): int32 {
  return point.x;
}
function assigned(n: number): Point {
  return Object.assign({ x: 1, y: 2 }, { x: n });
}
function widened(n: number): Point {
  const wide = { x: n, y: 2 };
  return wide;
}
function yOf(point: Point): int32 {
  return point.y;
}
console.log(xOf(assigned(1.5)), xOf(widened(2.5)), yOf(widened(3.5)), xOf({ x: 4, y: 5 }));
