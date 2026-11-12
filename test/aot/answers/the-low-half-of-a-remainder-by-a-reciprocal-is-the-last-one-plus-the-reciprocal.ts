// answers: with-library
// # `j % d` by a reciprocal c made in front of the loop is the high half of ((c * j mod 2^64) * d): two multiplications a turn, and both go to one port. Where the last remainder went by the same reciprocal and its
// # dividend was the same value plus another written number, c * (b + k2) = c * (b + k1) + c * (k2 - k1) mod 2^64, whatever b, k1 and k2 are: the low half is the last one plus the reciprocal. The dividend is widened by
// # its type, so that the counter of a turn laid out is the sum of the first counter and a written number. The last low half is taken wherever the builder would find it again: in its block and where that block alone leads.
// # f1 = inOneBlock, f2 = byThrees, f8 = leavesBetween
// # Eight turns laid out and the loop as written: two products where there were nine; by threes c * 3 is made once; where a test of the index leaves between the turns each turn is a block of its own.
// # The products are counted at the place of `%` itself: where the machine has no remainder (arm64) the remainder of two whole numbers that is made in line beside the loop is a quotient, a product and a difference, at another place.
// # RUN(FORM): emit f1 f2 f8 mechanisms=all
// # REQUIRES(FORM): as-written
// # FORM-LABEL: unit f1:Body
// # FORM-COUNT-2: Int64 @{{*}} = Mul({{*}}origin = 278)
// # FORM-NOT: Int64 @{{*}} = Mul({{*}}origin = 278)
// # FORM-LABEL: unit f2:Body
// # FORM-COUNT-3: Int64 @{{*}} = Mul({{*}}origin = 285)
// # FORM-NOT: Int64 @{{*}} = Mul({{*}}origin = 285)
// # FORM-LABEL: unit f8:Body
// # FORM-COUNT-2: Int64 @{{*}} = Mul({{*}}origin = 161)
// # FORM-NOT: Int64 @{{*}} = Mul({{*}}origin = 161)
// # Written sums upward and downward over one counter, another divisor in between, an unsigned reading of a counter that begins below zero, arms and what stands behind them.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 433 of 433 of 433
// # CHECK-NEXT: exited with 0
// # RUN(CHECKED): run-in-shell $SHELL testing=CheckProofsAtRunTime
// # CHECKED: 433 of 433 of 433
// # CHECKED-NEXT: exited with 0
declare function report(value: unknown): void;
function inOneBlock(d: number): number { const list = new Int32Array(10); for (let i = 0; i < 10; i++) for (let j = 0; j < 1003; j++) list[i] = list[i] + (j % d); return list[0] + list[9]; }
function byThrees(d: number): number { const list = new Int32Array(10); for (let i = 0; i < 10; i++) for (let j = 0; j < 1003; j += 3) list[i] = list[i] + (j % d); return list[0] + list[9]; }
function threeOverOneCounter(turns: number, d: number): number { let sum = 0; for (let i = 0; i < turns; i++) sum = (sum + (i % d) * 3 + ((i + 2) % d) * 5 + ((i + 3) % d)) | 0; return sum; }
function downward(turns: number, d: number): number { let sum = 0; for (let i = 0; i < turns; i++) sum = (sum + ((i + 3) % d) * 3 + ((i + 1) % d) * 5 + (i % d)) | 0; return sum; }
function twoDivisors(turns: number, d: number, e: number): number { let sum = 0; for (let i = 0; i < turns; i++) sum = (sum + (i % d) * 3 + ((i + 2) % e) * 5 + ((i + 3) % d)) | 0; return sum; }
function besideTheUnsigned(turns: number, d: number): number { let sum = 0; for (let i = 0; i < turns; i++) { const x = i - 1; sum = (sum + ((x >>> 0) % d) * 3 + ((x + 1) % d)) | 0; } return sum; }
function inArms(turns: number, d: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum = (sum + (i % d)) | 0; if (i & 1) sum = (sum + ((i + 1) % d) * 3) | 0; else sum = (sum + ((i + 2) % d) * 5) | 0; sum = (sum + ((i + 3) % d) * 7) | 0; } return sum; }
function leavesBetween(list: Int32Array, turns: number, d: number): number { for (let j = 0; j < turns; j++) list[j & 3] = list[j & 3] + (j % d); return list[0] + (list[1] << 1) + (list[2] << 2) + (list[3] << 3); }
const divisors = [40, 7, 3, 1, 65537, 2147483647];
const counts = [0, 1, 7, 8, 9, 15, 16, 17, 1003, 100003];
for (const d of divisors) { report(inOneBlock(d)); report(byThrees(d)); for (const turns of counts) { report(threeOverOneCounter(turns, d)); report(downward(turns, d)); report(twoDivisors(turns, d, 11)); report(twoDivisors(turns, 13, d)); report(besideTheUnsigned(turns, d)); report(inArms(turns, d)); report(leavesBetween(new Int32Array(4), turns, d)); } }
report("end");
