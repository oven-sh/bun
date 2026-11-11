function up(n) { for (var k = 0, t = 0; k < n % 7; k++) t += k * n; return t + 1; }
function twice(n) { for (var k = 0, t = 0; k < n % 5; k++) t -= k * n; return t * 2; }
function maybe(f, x) { if (f) return f(x); return 0; }
globalThis.keep = maybe;
var total = 0;
for (var i = 0; i < 1000; i++) total += maybe(i % 3 === 0 ? up : i % 3 === 1 ? twice : undefined, i);
console.log(total);
