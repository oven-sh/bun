// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the numbers are doubles; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
class Point { constructor(x, y, next) { this.x = x; this.y = y; this.next = next; } }
function pick(a, b, key, exact) { if (!a.y || !b.y || !a.next || !b.next) return "none"; const flag = exact ? key === a.x : key < b.x; const side = flag ? a : b; const y = flag ? a.y : b.y; if (y && side.next) return side.next.y + side.y + y; return "leaf"; }
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 1, false));
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 1, true));
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 3, false));
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 3, true));
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 9, false));
report(pick(new Point(1, 2.5, new Point(0, 10.25, null)), new Point(5, 3.5, new Point(0, 50.75, null)), 9, true));
report("end");
