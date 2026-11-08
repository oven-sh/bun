// The build proves what is stored through a type that says `int32`. An object that was made under another type with the same names is assignable to it, and the build does not stop there: the read tests.
import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
type Other = { x: number; y: number };
class Pixel { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function first(point: Point): int32 { return point.x; }
function sum(point: Point): number { return point.x + point.y; }
const given: number[] = JSON.parse("[2.5, 4294967296, -0]");
for (const n of given) {
  const other: Other = { x: n / 2, y: 1.5 };
  const seen = { get x(): number { return n / 4; }, get y(): number { return 2; } };
  console.log(first(other), sum(other), first(new Pixel(n, 1)), sum(new Pixel(n, 1)), first(seen), sum(seen), Object.is(first(new Pixel(n, 1)), -0));
}
console.log(first({ x: 1, y: 2 }), sum({ x: 3, y: 4 }));
