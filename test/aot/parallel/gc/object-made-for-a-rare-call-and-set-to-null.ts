// `point = null` is no reason to make the object on the path that never hands it out.
// STATISTIC: AllocationsSunk >= 1
type Point = { x: number; y: number };
const kept: Point[] = [];
function keep(point: Point) {
  kept.push(point);
}
function sum(count: number, rare: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    let point: Point | null = { x: i, y: i + 1 };
    if (i === rare) keep(point);
    total += point.x + point.y;
    point = null;
  }
  return total;
}
console.log(sum(1000, 7), kept.length, kept[0].x, kept[0].y);
