// If an integer stayed an integer however large it grows, sums and products past two to the fifty-third would be exact where a double rounds, and past two to the sixty-third they would wrap.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldDifference(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldProduct(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNext(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldPrevious(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldClimbed(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldSquared(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldField(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function add(a, b) { toldSum(a + b); }
function less(a, b) { toldDifference(a - b); }
function times(a, b) { toldProduct(a * b); }
function next(a) { a++; toldNext(a); }
function previous(a) { a--; toldPrevious(a); }
function climb(n, turns) { if (turns > 0) climb(n + n, turns - 1); else toldClimbed(n); }
function square(n, turns) { if (turns > 0) square(n * n, turns - 1); else toldSquared(n); }
class Counter { constructor() { this.n = 1; } double() { this.n = this.n + this.n; } tell() { toldField(this.n); } }
add(1, 2);
add(9007199254740991, 1);
add(9007199254740992, 1);
add(9007199254740992, 2);
add(9007199254740993, 2);
less(-9007199254740992, 1);
less(-9007199254740992, 3);
next(9007199254740991);
next(9007199254740992);
previous(-9007199254740992);
times(94906267, 94906267);
times(94906266, 94906266);
times(3037000500, 3037000500);
times(4294967296, 4294967296);
times(9007199254740993, 3);
climb(1, 3);
climb(1, 53);
climb(1, 54);
climb(1, 62);
climb(1, 63);
climb(1, 64);
climb(3, 62);
climb(1, 1023);
climb(1, 1024);
square(3, 1);
square(3, 5);
square(3, 6);
square(3, 10);
const counter = new Counter();
for (let i = 0; i < 70; i++) counter.double();
counter.tell();
report("end");
