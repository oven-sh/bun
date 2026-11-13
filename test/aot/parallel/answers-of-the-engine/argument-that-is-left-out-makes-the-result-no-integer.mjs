// If undefined, null, a boolean or a text among the operands did not count, NaN, -0, an infinity and a fraction would be held for integers.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldDifference(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldBits(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNext(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNumeric(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNegation(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldField(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function add(a, b) { toldSum(a + b); }
function less(a, b) { toldDifference(a - b); }
function bits(a, b) { toldBits(a | b); }
function next(a) { a++; toldNext(a); }
function numeric(a) { toldNumeric(+a); }
function minus(a) { toldNegation(-a); }
class Pair { constructor(first, second) { this.first = first; this.second = second; this.sum = first + second; } tell() { toldField(this.sum); } }
add(1, 2);
less(1, 2);
bits(1, 2);
next(1);
numeric(1);
minus(1);
new Pair(1, 2).tell();
add(1);
less(1);
bits(1);
next();
numeric();
minus();
new Pair(1).tell();
add(1, null);
add(1, true);
add(undefined, "x");
less(null, true);
minus(null);
minus(false);
numeric(null);
numeric(true);
numeric("");
numeric("0x10");
numeric("1e400");
numeric(" 12 ");
numeric("1.25");
numeric("-0");
add(1, 2);
report("end");
