// A generator that a loop walks, and one whose steps are called by hand.
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
const points: Point[] = []; for (let i = 0; i < 100; i++) points.push(new Point(i, 1));
function* walk(k: number): Generator<Point> { for (let i = 0; i < k; i++) yield points[i % 50]!; }
const loops: Record<string, (n: number) => number> = {
  "for-of": n => { let s = 0; for (const p of walk(n | 0)) s = (s + p.x) | 0; return s; },
  "next() by hand": n => { let s = 0; const it = walk(n | 0); for (let r = it.next(); !r.done; r = it.next()) s = (s + r.value.x) | 0; return s; },
  "the same elements by index": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + points[i % 50]!.x) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name]!(40));
else console.log(loops[loop]!(Number(iterations)));
export {};
