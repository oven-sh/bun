// Reads int32 fields with brackets, under a key that is one of a few names, a symbol or an enum member, as operands of operators and of Math functions whose results go where an int32 is declared.
import type { int32 } from "bun";

const depth = Symbol("depth");
enum Axis {
  X = "x",
  Y = "y",
}
class Point {
  x: int32 = 7;
  y: int32 = 12;
  [depth]: int32 = 5;
}

function take(n: int32): int32 {
  return n;
}
function countTo(point: Point, key: "x" | "y"): int32 {
  let sum: int32 = 0;
  for (let i: int32 = 0; i < point[key]; i++) sum = (sum + i) | 0;
  return sum;
}
function countWhile(point: Point): int32 {
  let i: int32 = 0;
  while (point[depth] > i) i++;
  return i;
}

let key: "x" | "y" = Date.now() > 0 ? "y" : "x";
const point = new Point();
const other = new Point();
other.y = 3;
const nothing = new Point();
nothing.y = 0;

const half = Math.floor(point[key] / 2);
const least = Math.min(point[depth], other[depth]);
const both = point[key] && other[key];
const same = +point[Axis.X];

console.log(
  take(point[key] && other[key]),
  take(nothing[key] && other[key]),
  take(point[key] && other[key] && 9),
  take(Math.min(point[key], other[key])),
  take(Math.max(point[key], 40)),
  take(Math.max(point[depth], other[Axis.Y])),
  take(Math.sign(point[key])),
  take(Math.sign(nothing[key])),
  take(Math.floor(point[key] / 5)),
  take(Math.floor(point[depth] / 2)),
  take(+point[key]),
  take(+point[depth]),
);
console.log(
  take(half),
  take(least),
  take(both),
  take(same),
  take(Math.min(Math.max(point[key], 0), 10)),
  take(Math.min(Date.now() > 0 ? point[key] : 0, 100)),
  take(Math.max(nothing[key] || 6, 3)),
  take(Math.max(point[key] ?? 6, 3)),
  take(Math.min(point[key]!, 11)),
  take(Math.min(point[key] as number, 11)),
);
console.log(countTo(point, key), countTo(point, "x"), countTo(nothing, key), countWhile(point));

let listed = "";
for (let i = 0; i < other[key]; i++) listed += take(i);
for (let i: int32 = 0; i <= other[key] - 1; i++) listed += take(i);
for (let i: int32 = point[depth]; i > 0; i--) listed += take(i);
console.log(listed);
