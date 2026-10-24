// The quotient of two 32-bit integers rounded down, up, to the nearest, toward zero and to 32 bits, the remainder, and the middle of two: every pair out of 21 integers at the ends of the ranges.
// STATISTIC: IntegerDivisionsReduced >= 10
const edge = [0, 1, -1, 2, -2, 3, -3, 7, -7, 10, 255, 256, 65535, 65536, 1000003, 2147483647, -2147483647, -2147483648, 2147483646, 1073741824, -1073741824];
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function floor(a, b) { a |= 0; b |= 0; return Math.floor(a / b); }
function ceil(a, b) { a |= 0; b |= 0; return Math.ceil(a / b); }
function round(a, b) { a |= 0; b |= 0; return Math.round(a / b); }
function trunc(a, b) { a |= 0; b |= 0; return Math.trunc(a / b); }
function or(a, b) { a |= 0; b |= 0; return (a / b) | 0; }
function not(a, b) { a |= 0; b |= 0; return ~~(a / b); }
function shift(a, b) { a |= 0; b |= 0; return (a / b) >> 0; }
function unsigned(a, b) { a |= 0; b |= 0; return (a / b) >>> 0; }
function unsignedBoth(a, b) { a >>>= 0; b >>>= 0; return Math.floor(a / b); }
function unsignedOr(a, b) { a >>>= 0; b >>>= 0; return (a / b) | 0; }
function rest(a, b) { a |= 0; b |= 0; return a % b; }
function both(a, b) { a |= 0; b |= 0; return Math.floor(a / b) * b + (a % b); }
function byTwo(a) { a |= 0; return show(Math.floor(a / 2)) + " " + show((a / 2) | 0) + " " + show(Math.trunc(a / 2)) + " " + show(Math.floor(a / -2)) + " " + show(Math.floor(a / 3)) + " " + show((a / 10) | 0) + " " + show(Math.floor(a / 1)) + " " + show(Math.floor(a / -1)) + " " + show((a / -1) | 0) + " " + show(Math.floor(a / 0)) + " " + show((a / 0) | 0) + " " + show(a % 2) + " " + show(a % -2) + " " + show(a % 1) + " " + show(a % 0) + " " + show(Math.floor(a / 4096)) + " " + show(Math.floor(a / 2147483647)) + " " + show(Math.floor(a / -2147483648)); }
function middle(low, high) { low |= 0; high |= 0; return show(Math.floor((low + high) / 2)) + " " + show(((low + high) / 2) | 0) + " " + show((low + high) >> 1) + " " + show((low + high) >>> 1); }
const all = [floor, ceil, round, trunc, or, not, shift, unsigned, unsignedBoth, unsignedOr, rest, both];
for (let warm = 0; warm < 2000; warm++) for (const f of all) f(warm, (warm % 9) + 1);
for (const a of edge) { console.log(a, byTwo(a)); for (const b of edge) console.log(a, b, all.map(f => show(f(a, b))).join(" "), middle(a, b)); }
