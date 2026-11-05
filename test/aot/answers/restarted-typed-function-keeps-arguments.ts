// answers: without-library
// # Functions with declared parameters are called with what was declared and with six objects that are something else: other key order, a text for a number, a missing field, fields on the prototype, a getter. What they had said and computed ahead of the failing test is said and computed once.
// # At the end the shell runs the same text itself: every answer is the same.
// # Where a guess about a list fails, `for of` goes by the protocol and calls `next` of the iterators of arrays, which is a function of the library. So the text brings that function.
// # Without mechanisms the program runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 48 of 48 of 48
// # CHECK-NEXT: exited with 0
let said = "";
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function length(point: Point, scale: number): number { const x = point.x * scale; const y = point.y * scale; return x * x + y * y; }
function named(point: Point, name: string): string { const text = name + ":"; return text + point.x + "," + point.y + "," + text.length; }
function counted(points: Point[], from: number): number { let sum = from; for (const point of points) sum += point.x; return sum; }
function both(first: Point, second: Point): number { const a = first.x; said += "a"; const b = second.x; return a + b; }
const odd: any[] = [{ x: 1, y: 2 }, { y: 2, x: 1 }, { x: "1", y: 2 }, { x: 1 }, Object.create(new Point(5, 6)), { get x() { said += "x"; return 3; }, y: 4 }];
report(length(new Point(3, 4), 2)); report(named(new Point(1, 2), "p")); report(counted([new Point(1, 2), new Point(3, 4)], 1)); report(both(new Point(1, 2), new Point(3, 4)));
for (const one of odd) { report(length(one, 2)); report(length(new Point(1, 1), one.x)); report(named(one, "q")); report(named(new Point(1, 2), one.y)); report(counted([new Point(1, 2), one], 1)); report(both(new Point(1, 2), one)); report(both(one, one)); }
report(said);
report("end");
