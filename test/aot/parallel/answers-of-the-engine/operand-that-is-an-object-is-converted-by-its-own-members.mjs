// If an object among the operands counted for nothing, or for a number, what its valueOf, its toString or its Symbol.toPrimitive answers would be lost: a text, a bigint, a fraction, an integer past int32.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldDifference(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldProduct(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldBits(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldNumeric(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldNext(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
class Text { valueOf() { return "s"; } }
class Count { constructor(n) { this.n = n; } valueOf() { return this.n; } }
class Big { valueOf() { return 5n; } }
class Hinted { [Symbol.toPrimitive](hint) { return hint === "number" ? 7 : hint === "string" ? "text" : "default"; } }
class Second { valueOf() { return this; } toString() { return 3; } }
class Never { valueOf() { return this; } toString() { return this; } }
class Plain { }
function add(a, b) { toldSum(a + b); }
function less(a, b) { toldDifference(a - b); }
function times(a, b) { toldProduct(a * b); }
function bits(a) { toldBits(a | 0); }
function numeric(a) { toldNumeric(+a); }
function next(a) { a++; toldNext(a); }
function tried(f, a, b) { try { f(a, b); } catch (error) { report("threw"); } }
add(1, 2);
less(3, 1);
times(2, 2);
bits(5);
numeric(6);
next(7);
add(new Count(1), 2);
less(new Count(3), new Count(1.5));
times(new Count(2147483647), 2);
bits(new Count(4294967297));
numeric(new Count(0.5));
next(new Count(2147483647));
add(new Text(), 1);
add(1, new Text());
less(new Text(), 1);
numeric(new Text());
bits(new Text());
tried(times, new Big(), 2n);
tried(add, new Big(), 1n);
tried(add, new Big(), 1);
tried(next, new Big());
add(new Hinted(), 1);
less(new Hinted(), 1);
numeric(new Hinted());
add(new Second(), 1);
tried(add, new Never(), 1);
add(new Plain(), 1);
less(new Plain(), 1);
add({ valueOf() { return 40; } }, 2);
report("end");
