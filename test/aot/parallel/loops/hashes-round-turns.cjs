// Sums of a value, a constant and a shift of the value, in each order, round the turns of loops.
function jenkins(seed, n) { for (var i = 0; i < n; i++) { seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff; seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff; seed = ((seed << 5) + (seed + 0x165667b1)) | 0; } return seed; }
function mixed(a, n) { var b = 0; for (var i = 0; i < n; i++) { a = (a + 5 + (a << 3)) | 0; b = ((b >> 2) + (b + a - 7)) | 0; a = ((a >>> 1) + (a + -2147483648)) | 0; b = (b + 1 + (a << 1)) | 0; a = (a + 3 + (b << 2)) | 0; } return a + ' ' + b; }
function wide(x, n) { for (var i = 0; i < n; i++) x = (x + 4294967297 + (x << 4)) % 1000003; return x; }
function doubles(x, n) { var s = 0; for (var i = 0; i < n; i++) { s = s + ((x + 0.5) + (x << 1)); x = x + 1; } return s; }
function same(x) { return [((x + 1) + (x << 0)) | 0, ((x + 1) + (x << 31)) | 0, ((x << 32) + (x + 9)) | 0, ((x + 2) + (x >> 31)) | 0, ((x + 2) + (x >>> 31)) | 0, ((x + 7) + (x << x)) | 0].join(); }
for (var x of [0, 1, -1, 2147483647, -2147483648, 49734321, 0.5, -0, NaN, '12', null, undefined]) console.log(jenkins(x, 0), jenkins(x, 1), jenkins(x, 50), mixed(x, 1), mixed(x, 40), wide(x, 9), doubles(x, 5), same(x));
