// If a product, a remainder, a quotient, a power or a negation of integers were an integer, -0, NaN, the infinities and fractions would be lost.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function toldProduct(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldRest(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldQuotient(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldNegation(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldSum(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldDifference(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldPower(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function toldHalved(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n < -2147483648); report(n === n); report(1 / n); report(n % 1); report(typeof n); }
function times(a, b) { toldProduct(a * b); }
function rest(a, b) { toldRest(a % b); }
function over(a, b) { toldQuotient(a / b); }
function minus(a) { toldNegation(-a); }
function add(a, b) { toldSum(-a + -b); }
function less(a, b) { toldDifference(-a - b); }
function power(a, b) { toldPower(a ** b); }
function halve(n, turns) { if (turns > 0) halve(n / 2, turns - 1); else toldHalved(n); }
times(2, 3);
times(0, -1);
times(-1, 0);
times(0, 0);
rest(7, 3);
rest(-4, 2);
rest(-7, 3);
rest(4, 0);
rest(0, -3);
over(6, 3);
over(1, 2);
over(1, 0);
over(-1, 0);
over(0, 0);
over(0, -5);
minus(0);
minus(5);
add(0, 0);
add(1, 2);
less(0, 0);
less(1, 2);
power(2, 2);
power(2, -1);
power(0, -1);
halve(8, 3);
halve(8, 4);
halve(8, 5);
report("end");
