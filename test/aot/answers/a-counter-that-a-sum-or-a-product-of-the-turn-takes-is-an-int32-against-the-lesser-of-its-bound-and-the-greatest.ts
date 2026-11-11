// answers: with-library
// # In `for (let i = 0; i < count; i++) total += i`, count is a number that nothing has proven to be an integer. The counter used to go around the loop as a 53-bit integer
// # that was checked against 2^53 in every iteration, the sum was computed in 64 bits and tested for whether it fits, and every iteration held a poll:
// # 13 instructions per iteration for `total = (total + i) | 0`.
// # An iteration that computes with its counter (a sum or a product that is not the counter's step takes it as an operand) uses the counter as an integer,
// # as a key, a bitwise operator or an argument does. The loop is versioned for its bound: in the specialized version the counter is an int32 that is compared against
// # the lesser of the rounded bound and 2^31 - 1. That is the kind of loop that the code generator unrolls. A counter that no iteration reads causes no versioning, as before.
// # f1 = cut, f2 = added, f7 = top, f11 = unread
// # RUN(FORM): walk f1 f2 f7 f11 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f2:Body
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f7:Body
// # FORM: int[2147483640, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f11:Body
// # FORM-NOT: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # The loops run with bounds of every kind. The loops that start at 2147483640 cover the last step that is still an int32 and the iteration that continues in the generic version.
// # At the end, the shell runs the same source itself, and every result is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
// # RUN(FAILED): run-in-shell $SHELL testing=FailSpeculations
// # FAILED: 28 of 28 of 28
// # FAILED-NEXT: exited with 0
// # RUN(CHECKED): run-in-shell $SHELL testing=CheckProofsAtRunTime
// # CHECKED: 28 of 28 of 28
// # CHECKED-NEXT: exited with 0
// # Fault injection, testing=MisroundLoopBounds: the preheader rounds the bound as for <= where the loop header tests <, and the other way around.
// # With the bounds 15.5 and 0.5 the loop silently runs one iteration too few or too many. No type is wrong there.
// # With testing=CheckProofsAtRunTime, the header of the specialized version checks in every iteration that the comparison against the rounded bound
// # gives the same result as the comparison as written.
// # RUN(LIE): run-in-shell $SHELL mechanisms=all testing=MisroundLoopBounds
// # REQUIRES(LIE): as-written
// # LIE: 26 of 28 of 28
// # RUN(STOPPED): run-in-shell $SHELL mechanisms=all testing=CheckProofsAtRunTime,MisroundLoopBounds
// # STOPPED: bun: internal AOT error: redundancy elimination check failed
// # STOPPED-NEXT: a load or check that the compiler removed as redundant gives a different result here
// # STOPPED-NOT: of 28 of 28
// # STOPPED: crashed with
declare function report(value: unknown): void;
function cut(count: any): number { let total = 0; for (let i = 0; i < count; i++) total = (total + i) | 0; return total; }
function added(count: any): number { let total = 0; for (let i = 0; i < count; i++) total += i; return total; }
function ofNumber(given: any): number { const count = +given; let total = 0.5; for (let i = 0; i < count; i++) total += i; return total; }
function orEqual(count: any): number { let total = 0; for (let i = 0; i <= count; i++) total -= i; return total; }
function multiplied(count: any): number { let total = 0; for (let i = 0; i < count; i++) total = (total + i * 3) | 0; return total; }
function byTwos(count: any): number { let total = 0; for (let i = 0; i < count; i += 2) total += i; return total; }
function top(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i++) { total += i; if (++turns === 20) break; } return total + ":" + turns; }
function topCut(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i++) { total = (total + i) | 0; if (++turns === 20) break; } return total + ":" + turns; }
function topOrEqual(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i <= count; i++) { total += i * 2; if (++turns === 20) break; } return total + ":" + turns; }
function topByTwos(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i += 2) { total += i; if (++turns === 20) break; } return total + ":" + turns; }
function unread(count: any, k: number): number { let total = 0; for (let i = 0; i < count; i++) total += k; return total; }
const bounds: unknown[] = [0, 1, 7, 8, 9, 17, 15.5, 0.5, -1, -0, NaN, undefined, null, true, "3", "x", -Infinity];
const tops: unknown[] = [2147483640, 2147483641, 2147483646, 2147483647, 2147483648, 2147483649.5, 2147483655, 4294967296, Infinity, NaN];
for (const b of bounds) report([cut(b), added(b), ofNumber(b), orEqual(b), multiplied(b), byTwos(b), unread(b, 0.25)].join(" "));
for (const b of tops) report([top(b), topCut(b), topOrEqual(b), topByTwos(b)].join(" "));
report("end");
