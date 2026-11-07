// answers: without-library
// # `const limit = options.limit ?? Infinity`, `limit = Infinity` as a default, a bound of no declared type: no number by its type. The bound itself was asked for an int32 in front of the loop, and Infinity for "no limit" failed that one test: the
// # whole loop ran in the other build. Now what fails is asked for a number and rounded: an int32 (a fraction) is taken; above them 2^31 - 1; the head of the typed build asks the counter against that, and the rounding stands beside it for the way
// # out. Below every int32, NaN, a text, null, a big integer, an object that is asked for its value in every turn: the other build, from the start.
// # f1 = orInfinity, f3 = ofAnything
// # RUN(FORM): walk f1 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=number
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Less {{*}}form=Integers
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f3:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: = TypeTest {{*}}testedType=number
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Less {{*}}form=Integers
// # FORM: @Int32 = Increment {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 38 of 38 of 38
// # CHECK-NEXT: exited with 0
function orInfinity(list: number[], options: { limit?: number }): string { const limit = options.limit ?? Infinity; let total = 0; let turns = 0; for (let i = 0; i < limit; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function byDefault(list: number[], limit: number = Infinity): string { let total = 0; let turns = 0; for (let i = 0; i < limit; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function ofAnything(list: number[], limit: any): string { let total = 0; let turns = 0; for (let i = 0; i < limit; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function upToAnything(list: number[], limit: any): string { let total = 0; let turns = 0; for (let i = 0; i <= limit; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function fromTheTop(list: number[], limit: any): string { let last = -1; let turns = 0; for (let i = 2147483644; i < limit; i++) { last = i + list[i & 3]!; if (++turns === 6) break; } return last + " in " + turns; }
const four = [1, 2, 3, 4];
let calls = 0;
const counted = { valueOf() { calls++; return 3; } };
const bags = JSON.parse('[{}, {"limit":3}, {"limit":2.5}, {"limit":0}, {"limit":-1}, {"limit":1e999}, {"limit":-1e999}, {"limit":2147483647}, {"limit":2147483648}, {"limit":4294967301}, {"limit":null}]');
for (let at = 0; at < bags.length; at++) report(at + ": " + orInfinity(four, bags[at]) + " . " + byDefault(four, bags[at].limit));
const limits: any[] = [3, 2.5, -0, "4", "x", "", null, undefined, true, false, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, 2147483649, 4294967296, 9007199254740992, 1e300, -2147483648, -2147483649, 5n, -5n, 2147483650n, counted];
for (let at = 0; at < limits.length; at++) report(at + ": " + ofAnything(four, limits[at]) + " . " + upToAnything(four, limits[at]) + " . " + fromTheTop(four, limits[at]) + " . " + calls);
report("end");
declare function report(value: unknown): void;
