// If the result of an operator were a number as soon as its operands held numbers, the bigint that comes later would be added, negated, counted, masked and shifted as a double. A bigint beside a number throws.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldSum(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldProduct(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldNegation(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldNext(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldBefore(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldBits(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldFlipped(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldShifted(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function toldNumeric(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); }
function add(a, b) { toldSum(a + b); }
function times(a, b) { toldProduct(a * b); }
function minus(a) { toldNegation(-a); }
function next(a) { a++; toldNext(a); }
function before(a) { let was = a--; toldBefore(was); }
function bits(a, b) { toldBits((a | b) ^ (a & b)); }
function flip(a) { toldFlipped(~a); }
function shift(a, b) { toldShifted(a << b); }
function numeric(a) { toldNumeric(+a); }
function tried(f, a, b) { try { f(a, b); } catch (error) { report("threw"); } }
tried(add, 1, 2);
tried(times, 3, 4);
tried(minus, 5);
tried(next, 6);
tried(before, 7);
tried(bits, 12, 10);
tried(flip, 8);
tried(shift, 1, 4);
tried(numeric, 9);
tried(add, 1n, 2n);
tried(times, 3n, 4n);
tried(minus, 5n);
tried(next, 6n);
tried(before, 7n);
tried(bits, 12n, 10n);
tried(flip, 8n);
tried(shift, 1n, 70n);
tried(numeric, 9n);
tried(add, 1n, 2);
tried(times, 3, 4n);
tried(bits, 12n, 10);
tried(add, 1n, "2");
tried(add, 1, 2);
report("end");
