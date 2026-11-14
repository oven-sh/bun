// answers: without-library
// # `for (let i = start; i < limit; i++)`, both numbers: what enters is asked for an int32 in front of the loop, and the bound was asked for one beside it: `limit = Infinity` failed that test and the whole loop ran in the other build. The bound of such
// # a counter takes the lesser bound too: it is rounded, the head of the typed build asks the counter against the lesser of the rounding and 2^31 - 1, and the rounding stands beside it for the way out. Fourteen starts against fifteen bounds, < and <=.
// # f1 = fromTo
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: i32 @Int32) isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Less {{*}}form=Integers
// # FORM: @Int32 = Increment {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
function fromTo(list: number[], start: number, limit: number): string { let total = 0; let turns = 0; for (let i = start; i < limit; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function fromUpTo(list: number[], start: number, limit: number): string { let last = -1; let turns = 0; for (let i = start; i <= limit; i++) { last = i + list[i & 3]!; if (++turns === 6) break; } return last + " in " + turns; }
const four = [1, 2, 3, 4];
const starts = [0, -0, 3, -2, 2.5, NaN, 2147483644, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, Infinity, -Infinity];
const limits = [5, 0, 2.5, -1, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, 2147483650, 4294967301, 9007199254740992, 1e300, -2147483646];
for (let at = 0; at < starts.length; at++) { const start = Number(starts[at]); let line = start + ":"; for (let to = 0; to < limits.length; to++) { const limit = Number(limits[to]); line += " " + fromTo(four, start, limit) + " | " + fromUpTo(four, start, limit); } report(line); }
report("end");
declare function report(value: unknown): void;
