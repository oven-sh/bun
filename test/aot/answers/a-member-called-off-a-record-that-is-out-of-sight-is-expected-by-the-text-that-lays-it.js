// answers: with-library
// # `lib.add(..)`, `new Point(..)` behind `var Point = lib.Point`: the record is stored on the global object, so anybody may store into it and Link proves nothing of its members.
// # The text lays one function under each name: that function is expected at the call: a test of the callee behind the read, then the direct call or its body in line.
// # f1 = add, f2 = low, f3 = Point, f4 = sums, f5 = makes
// # RUN(ADD): link variables mechanisms=all
// # REQUIRES(ADD): entries-of-bun
// # ADD: laid-under-name g{{*}} "add" f1
// # RUN(LOW): link variables mechanisms=all
// # REQUIRES(LOW): entries-of-bun
// # LOW: laid-under-name g{{*}} "low" f2
// # RUN(POINT): link variables mechanisms=all
// # REQUIRES(POINT): entries-of-bun
// # POINT: taken-out-of-required-file g{{*}} f3
// # RUN(FIRST): walk f4 mechanisms=all
// # REQUIRES(FIRST): entries-of-bun
// # FIRST: TypeTest {{*}}testedType=f1
// # RUN(SECOND): walk f4 mechanisms=all
// # REQUIRES(SECOND): entries-of-bun
// # SECOND: TypeTest {{*}}testedType=f2
// # RUN(MAKES): walk f5 mechanisms=all
// # REQUIRES(MAKES): entries-of-bun
// # MAKES: TypeTest {{*}}testedType=f3
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
const lib = { add: function add(a, b) { return a + b | 0; }, low: function low(a) { return a & 15; }, Point: function Point(x) { this.x = x & 15; }, rate: 3 };
globalThis.kept = lib;
var Point = lib.Point;
function sums(t) { let all = t & 1; for (let turn = 0; turn < 10; turn++) all = all + (lib.add(turn, t) + lib.low(turn)) | 0; return all; }
function makes(t) { const made = new Point(t); return made.x; }
report(sums(3));
report(makes(21));
globalThis.kept.add = function other(a, b) { return a - b | 0; };
report(sums(3));
globalThis.kept.low = 7;
try { report(sums(3)); } catch (error) { report(error instanceof TypeError); }
delete globalThis.kept.low;
try { report(sums(3)); } catch (error) { report(error instanceof TypeError); }
globalThis.kept.Point = function Another(x) { this.x = -x; };
report(makes(21));
report(new globalThis.kept.Point(2).x);
report("end");
