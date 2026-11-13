// parseInt of a number outside of loops: one leaf in place of a string and its parse.
// STATISTIC: NumbersParsedByLeaf >= 4
const shown = v => Object.is(v, -0) ? "-0" : String(v);
function half(n) { return parseInt(n / 2); }
function scaled(n, by) { return parseInt(n * by); }
function digits(c, a) { return (c < a ? "" : digits(parseInt(c / a), a)) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36)); }
function byNumber(n) { return Number.parseInt(n - 0.25); }
function withRadix(n) { return [parseInt(n / 3, 10), parseInt(n / 3, 0), parseInt(n / 3, 16), parseInt(n / 3, 2), parseInt(n / 3, undefined)].map(shown).join(); }
function unused(n) { parseInt(n / 7); return n; }
function either(n, text) { return parseInt(n > 5 ? n / 3 : text); }
const numbers = [0, -0, 1, -1, 0.5, -0.5, 0.0000001, -0.0000001, 0.000001, 0.00000099, 1e21, 1e22, -1e21, 123456789012345680000, 1.7976931348623157e308, 5e-324, NaN, Infinity, -Infinity, 2147483647.9, 2147483648.5, -2147483649.5, 4294967295.99, 9007199254740991, 9007199254740993, 1e15 + 0.5, 12.99, -12.99, 1e-7, 1.5e300, -3.2e-9, 999999999999999900000];
for (const n of numbers) console.log(shown(n), shown(half(n)), shown(scaled(n, 1)), shown(scaled(n, 1e-7)), shown(byNumber(n)), withRadix(n), shown(either(n, "42px")), shown(unused(n)));
console.log([0, 5, 35, 36, 61, 62, 63, 1000, 3843, 3844, 99999].map(c => digits(c, 62)).join());
let sum = 0;
for (let i = 0; i < 3000; i++) { sum = (sum * 31 + half(i * 1.37) + scaled(i, 0.01) + byNumber(i / 3) + digits(i, 62).length) | 0; }
console.log(sum);
