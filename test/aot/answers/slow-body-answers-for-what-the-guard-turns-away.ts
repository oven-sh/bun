// answers: without-library
// # A function whose parameters are tested at its entry has a slow body for whatever the test turns away. With testing=WritesBodiesStraight it is written straight, as every body is.
// # Without the switch the slow bodies alone are written straight: a-slow-body-is-written-straight.ir.
// # OPTIONS: testing=WritesBodiesStraight
// # RUN(STRAIGHT): compile UnitsWrittenStraight mechanisms=all
// # REQUIRES(STRAIGHT): faulting-loop-polls
// # STRAIGHT: statistic UnitsWrittenStraight 16
// # RUN(WITHHELD): compile UnitsWrittenStraight mechanisms=all-ParameterGuards
// # REQUIRES(WITHHELD): faulting-loop-polls
// # WITHHELD: statistic UnitsWrittenStraight 13
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 58 of 58 of 58
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function norm(p: Point, scale: number): number { let sum = 0; for (let i = 0; i < 3; i++) sum += p.x * scale + p.y; return sum; }
function label(p: Point, prefix: string): string { return prefix + ":" + p.x + "," + p.y; }
function grow(p: Point, by: number): Point { const next = new Point(p.x + by, p.y + by); return next; }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
const whole = new Point(1, 2);
const others: any[] = [{ x: 3, y: 4 }, { y: 5, x: "s" }, { get x() { return 6; }, y: 7 }, null, undefined, 8, "text", [9, 10]];
for (let round = 0; round < 3; round++) { report(norm(whole, 2)); report(label(whole, "p")); report(grow(whole, round).x); }
for (let which = 0; which < 8; which++) { const other = others[which]; report(tell(() => norm(other, 2))); report(tell(() => norm(whole, other))); report(tell(() => label(other, "q"))); report(tell(() => label(whole, other))); report(tell(() => grow(other, 1).x)); report(tell(() => grow(whole, other).y)); }
report("end");
