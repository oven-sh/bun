// If Link kept int32 for a sum, a difference, a product, a negation or a step of integers that fit int32, each of these would wrap. Only a bit operation gives int32, and an unsigned shift does not.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldDifference(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldProduct(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNegation(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNext(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldPrevious(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldLeft(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldRight(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldUnsigned(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldBits(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldFlipped(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldPower(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldGrown(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldField(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldCapture(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldClimbed(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function add(a, b) { toldSum(a + b); }
function less(a, b) { toldDifference(a - b); }
function times(a, b) { toldProduct(a * b); }
function minus(a) { toldNegation(-a); }
function next(a) { a++; toldNext(a); }
function previous(a) { a--; toldPrevious(a); }
function left(a, b) { toldLeft(a << b); }
function right(a, b) { toldRight(a >> b); }
function unsigned(a, b) { toldUnsigned(a >>> b); }
function bits(a) { toldBits(a | 0); }
function flip(a) { toldFlipped(~a); }
function power(a, b) { toldPower(a ** b); }
function grown(n) { let sum = 2147483000; for (let i = 0; i < n; i++) { sum = sum + i; } toldGrown(sum); }
function climb(n, turns) { if (turns > 0) climb(n + n, turns - 1); else toldClimbed(n); }
class Counter { constructor() { this.n = 2147483646; } step() { this.n = this.n + 1; } tell() { toldField(this.n); } }
function keeper() { let kept = 2147483646; return { step() { kept = kept + 1; }, tell() { toldCapture(kept); } }; }
add(1, 2);
add(2147483647, 1);
add(2147483647, 2147483647);
add(-2147483648, -1);
less(3, 1);
less(-2147483648, 1);
less(2147483647, -1);
times(3, 4);
times(65536, 65536);
times(-65536, 32768);
times(46341, 46341);
minus(5);
minus(-2147483648);
next(1);
next(2147483647);
previous(1);
previous(-2147483648);
left(1, 31);
left(1, 32);
left(2147483647, 1);
right(-2147483648, 31);
unsigned(1, 0);
unsigned(-1, 0);
unsigned(-1, 1);
unsigned(-2147483648, 0);
bits(2147483647);
bits(-2147483648);
flip(2147483647);
flip(-2147483648);
power(2, 3);
power(2, 31);
power(2, 32);
grown(100);
climb(1, 3);
climb(1, 31);
climb(1, 32);
climb(1, 40);
const counter = new Counter();
counter.step();
counter.tell();
counter.step();
counter.tell();
const kept = keeper();
kept.step();
kept.tell();
kept.step();
kept.tell();
report("end");
