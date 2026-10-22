// A function that returns a fresh literal is split, so that a caller who only reads the literal need not make it. Where the part that works out the members is tiny, the function itself does not call it.
// CALLS- pair f:pair
// CALLS- point f:point
// CALLS+ summed f:summed
type Point = { x: number; y: number };
function pair(a: string, b: string): string[] { return [a, b]; }
function point(x: number, y: number): Point { return { x, y }; }
function swapped(p: Point): Point { return { x: p.y, y: p.x }; }
function summed(list: number[]): Point {
  let x = 0;
  let y = 0;
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    if (value === undefined) continue;
    if (i & 1) y += value * value - i;
    else x += Math.sqrt(value + i) * 2;
    if (x > 1e9 || y > 1e9) break;
  }
  return { x, y };
}
const pairs: ((a: string, b: string) => string[])[] = [pair];
const points: ((x: number, y: number) => Point)[] = [point];
const changes: ((p: Point) => Point)[] = [swapped];
const sums: ((list: number[]) => Point)[] = [summed];
console.log(pairs[0]("a", "b").join(), JSON.stringify(points[0](1, 2)), JSON.stringify(changes[0]({ x: 3, y: 4 })), JSON.stringify(sums[0]([1, 2, 3, 4])));
console.log(pair("c", "d").length, point(5, 6).y, swapped(point(7, 8)).x, summed([9, 16]).y);
