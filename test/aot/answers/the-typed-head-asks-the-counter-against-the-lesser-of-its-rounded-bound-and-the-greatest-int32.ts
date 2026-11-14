// answers: without-library
// # `for (let i = 0; i < count; i++)`, count a number: behind i < bound the counter may still be 2^53, and 2^53 + 1 is not exact: it went from an integer register into a double and back in every turn. Where the loop is built twice anyway and
// # its turns take the counter as an integer, the bound is rounded in front of the loop, as the walk rounds it anyway; the head of the typed build asks the counter against the lesser of that and 2^31 - 1, so the counter is an int32 there; where
// # the head's test fails, the rounded bound itself is asked: the loop ends, or the turn is handed over to the other build. No bound sends the whole loop there but one below every int32 (and NaN), where no turn runs: `limit = Infinity` runs typed.
// # Counters from both ends of the int32s (they cross 2^31 - 1 within six turns), by one and by three, <= and <, two bounds in one loop, a half; `n > i` and counters that go down stay as they were.
// # f10 = outOfList, f12 = half
// # RUN(FORM): walk f10 f12 mechanisms=all
// # FORM-LABEL: code f10:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Less {{*}}form=Integers
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f12:Body
// # FORM: 2147483647 @Int64 = Integer
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: = TypeTest {{*}}testedType=i32
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: = Less {{*}}form=Integers
// # FORM: = Less {{*}}form=Integers
// # FORM: @Int32 = Increment {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 77 of 77 of 77
// # CHECK-NEXT: exited with 0
function Pair(this: any, first: number, second: number) { this.first = first; this.second = second; }
Pair.prototype.sum = function (this: any): number { return this.first + this.second; };
function up(count: number): string { let total = 0; let turns = 0; for (let i = 0; i < count; i++) { const pair = new (Pair as any)(i & 1023, 1); total += pair.sum(); if (++turns === 6) break; } return total + " in " + turns; }
function upTo(count: number): string { let total = 0; let turns = 0; for (let i = 0; i <= count; i++) { const pair = new (Pair as any)(i & 1023, 1); total += pair.sum(); if (++turns === 6) break; } return total + " in " + turns; }
function upFrom(count: number): string { let last = -1; let turns = 0; for (let i = 2147483644; i < count; i++) { const pair = new (Pair as any)(i, 1); last = pair.sum(); if (++turns === 6) break; } return last + " in " + turns; }
function upToFrom(count: number): string { let last = -1; let turns = 0; for (let i = 2147483644; i <= count; i++) { const pair = new (Pair as any)(i, 1); last = pair.sum(); if (++turns === 6) break; } return last + " in " + turns; }
function byThree(count: number): string { let last = -1; let turns = 0; for (let i = 2147483640; i < count; i += 3) { const pair = new (Pair as any)(i, 1); last = pair.sum(); if (++turns === 6) break; } return last + " in " + turns; }
function down(count: number): string { let last = 1; let turns = 0; for (let i = 3; i > count; i--) { const pair = new (Pair as any)(i, 1); last = pair.sum(); if (++turns === 6) break; } return last + " in " + turns; }
function downFrom(count: number): string { let last = 1; let turns = 0; for (let i = -2147483645; i >= count; i--) { const pair = new (Pair as any)(i, -1); last = pair.sum(); if (++turns === 6) break; } return last + " in " + turns; }
function boundOnLeft(count: number): string { let total = 0; let turns = 0; for (let i = 0; count > i; i++) { const pair = new (Pair as any)(i & 1023, 1); total += pair.sum(); if (++turns === 6) break; } return total + " in " + turns; }
function outOfList(list: number[], count: number): string { let total = 0; let turns = 0; for (let i = 0; i < count; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
function twoBounds(list: number[], count: number, most: number): string { let total = 0; let turns = 0; for (let i = 0; i < count; i++) { if (i >= most || turns === 6) break; total += list[i & 3]!; turns++; } return total + " in " + turns; }
function half(list: number[], count: number): string { const most = count / 2; let total = 0; let turns = 0; for (let i = 0; i < most; i++) { total += list[i & 3]!; if (++turns === 6) break; } return total + " in " + turns; }
const four = [1, 2, 3, 4];
const bounds = [5, 0, -0, -1, 1, 2.5, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, 2147483649, 4294967295, 4294967296, 4294967301, 9007199254740991, 9007199254740992, 1e300, -2147483647, -2147483648, -2147483649, -4294967296];
for (let at = 0; at < bounds.length; at++) { const bound = Number(bounds[at]); report(bound + ": " + up(bound) + " . " + upTo(bound) + " . " + upFrom(bound) + " . " + upToFrom(bound) + " . " + byThree(bound)); }
for (let at = 0; at < bounds.length; at++) { const bound = Number(bounds[at]); report(bound + ": " + down(bound) + " . " + downFrom(bound) + " . " + boundOnLeft(bound) + " . " + outOfList(four, bound)); }
for (let at = 0; at < bounds.length; at++) { const bound = Number(bounds[at]); report(bound + ": " + twoBounds(four, bound, 3) + " . " + twoBounds(four, 3, bound) + " . " + twoBounds(four, bound, bound) + " . " + half(four, bound)); }
const loose: any = up;
report(loose("4") + " . " + loose(undefined) + " . " + loose(null) + " . " + loose(true) + " . " + loose({ valueOf() { return 2; } }) + " . " + loose("x"));
report("end");
declare function report(value: unknown): void;
