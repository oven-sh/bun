// answers: without-library
// # Behind a test of the shape a call by name goes through the method table, which tests nothing: the run time repoints a row when the guard of its name ends, and an entry asks the receiver whether it still stands below what its class made. Text that the build has not seen moves an object, hides, replaces, adds, deletes and redefines methods.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
class Shape { edge = 2; sides = 4; area(k: number) { return this.edge * k; } around(k: number) { return this.edge * this.sides + this.area(k); } }
class Disk extends Shape { round = 1; area(k: number) { return this.edge * k * 3; } }
function measure(s: Shape) { return s.edge + s.sides + s.area(1) + s.around(1); }
(globalThis as any).Shape = Shape;
(globalThis as any).Disk = Disk;
(globalThis as any).touch = null;
function both(change: string) { const a = new Shape(), b = new Disk(); (globalThis as any).touch = b; (0, eval)(change); report(measure(a)); report(measure(b)); }
both("0");
both("Object.setPrototypeOf(touch, { area(k) { return 100; }, around(k) { return 1000; } })");
both("0");
both("touch.area = k => 200");
both("0");
both("Shape.prototype.area = function (k) { return 7; }");
both("Disk.prototype.around = function (k) { return 9; }");
both("delete Disk.prototype.area");
both("Object.defineProperty(Shape.prototype, 'area', { get() { return k => 11; }, configurable: true })");
let thrown = "nothing";
try { both("Shape.prototype.around = 5"); } catch (error) { thrown = String(error instanceof TypeError); }
report(thrown);
report("end");
