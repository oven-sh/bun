// answers: without-library
// # A field that was removed and added again lies outside its slot. Typed code reads by slot behind a test of the slot; what it counted, logged, made or stored in front of the failing test has happened once.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 21 of 21 of 21
// # CHECK-NEXT: exited with 0
interface Point { x: number; y: number }
let calls = 0;
const log: string[] = [];
function moved(x: number, y: number): Point { const point: Point = { x, y }; delete (point as any).y; point.y = y; return point; }
function sum(point: Point): number { return point.x + point.y; }
report(sum({ x: 1, y: 2 })); report(sum(moved(3, 4)));
function countThenSum(point: Point): number { calls++; return point.x + point.y; }
report(countThenSum({ x: 1, y: 2 })); report(countThenSum(moved(3, 4))); report(calls);
function sumThenCount(point: Point): number { const total = point.x + point.y; calls++; return total; }
report(sumThenCount({ x: 1, y: 2 })); report(sumThenCount(moved(3, 4))); report(calls);
function between(point: Point): number { const x = point.x; log.push("between"); return x + point.y; }
report(between({ x: 1, y: 2 })); report(between(moved(3, 4))); report(log.length);
function made(point: Point): Point { const copy: Point = { x: point.x, y: 0 }; copy.y = point.y; return copy; }
report(made({ x: 1, y: 2 }).y); report(made(moved(3, 4)).y);
function both(a: Point, b: Point): number { return a.x + a.y + b.x + b.y; }
report(both({ x: 1, y: 2 }, moved(3, 4))); report(both(moved(1, 2), { x: 3, y: 4 })); report(both(moved(1, 2), moved(3, 4)));
function stored(point: Point, value: number): number { point.x = value; return point.x + point.y; }
report(stored({ x: 1, y: 2 }, 5)); report(stored(moved(3, 4), 5));
function inLoop(points: Point[]): number { let total = 0; for (let i = 0; i < points.length; i++) { calls++; total += points[i].x + points[i].y; } return total; }
report(inLoop([{ x: 1, y: 2 }, moved(3, 4), { x: 5, y: 6 }])); report(calls);
report("end");
