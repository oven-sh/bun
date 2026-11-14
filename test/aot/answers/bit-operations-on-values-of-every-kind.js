// answers: without-library
// # The closed form of a bit operation works on two int32 in place and leaves every other pair of operands to its stub: doubles, texts, booleans, null, undefined, an object with valueOf, BigInts alone and mixed with numbers.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 155 of 155 of 155
// # CHECK-NEXT: exited with 0
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
function and(a, b) { return a & b; }
function or(a, b) { return a | b; }
function xor(a, b) { return a ^ b; }
function left(a, b) { return a << b; }
function right(a, b) { return a >> b; }
function mask(a) { return a & 12; }
function masked(a) { return 12 & a; }
function whole(a) { return a | 0; }
const counted = { count: 0, valueOf() { this.count++; return 13; } };
const values = [5, -5, 2147483647, -2147483648, 4294967301, 1.9, -1.9, NaN, Infinity, -0, "7", "x", "", true, false, null, undefined, counted, 9n];
for (let index = 0; index < 19; index++) { report(attempt(() => mask(values[index]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => masked(values[index]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => whole(values[index]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => and(values[index], values[18 - index]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => or(values[index], values[(index + 1) % 19]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => xor(values[index], values[(index + 3) % 19]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => left(values[index], values[(index + 5) % 19]))); }
for (let index = 0; index < 19; index++) { report(attempt(() => right(values[index], values[(index + 7) % 19]))); }
report(and(9n, 12n) === 8n);
report(counted.count);
report("end");
