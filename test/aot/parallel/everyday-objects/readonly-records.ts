// Readonly records and tuples, changed by copies in a loop
type Point = readonly [x: number, y: number];
interface Step { readonly by: Point; readonly times: number }
function walk(start: Point, steps: readonly Step[]): string {
  let at: Point = start;
  const path: Point[] = [at];
  for (const { by: [dx, dy], times } of steps) {
    for (let i = 0; i < times; i++) {
      at = [at[0] + dx, at[1] + dy];
      path.push(at);
    }
  }
  const far = path.reduce((best, [x, y]) => Math.max(best, x * x + y * y), 0);
  return path.map(([x, y]) => `${x}:${y}`).join(" ") + " " + far;
}
console.log(walk([0, 0], [{ by: [1, 0], times: 2 }, { by: [0, -1], times: 1 }]));
console.log(walk([10, 5], [{ by: [-5, -5], times: 2 }]));
console.log(walk([3, 4], []));
