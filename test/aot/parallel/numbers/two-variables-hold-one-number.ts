// Two variables and a parameter hold one number: a stretch that asks for all three asks it once.
let first: number = 2;
let second: number = 2;
interface Point { x: number; y: number }
function scales(o: Point, a: number): number { first = a; second = a; return o.x * a + o.y * first - o.x * second + (o.y - first) * second; }
function reads(o: Point): number { const held = first; return o.x * first + o.y * second - o.x * held + (o.y - second) * first; }
const lines: string[] = [];
const values: any[] = [3, -0, 0.5, NaN, "4", undefined, null, 2n, true, { valueOf() { return 5; } }];
const show = (run: () => any): string => { try { const v = run(); return Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (e: any) { return e.name; } };
for (const value of values) for (const x of values) {
  const point: any = JSON.parse('{"x":1.5,"y":2}');
  point.x = x;
  lines.push([show(() => scales(point, value)), show(() => reads(point)), show(() => scales(point, 1))].join());
}
let total = 0;
for (let i = 0; i < 5; i++) total += scales(JSON.parse('{"x":1.5,"y":2}'), JSON.parse("3")) + reads({ x: i, y: 2 });
console.log(lines.join("\n"), total);
export {};
