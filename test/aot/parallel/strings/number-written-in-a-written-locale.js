// numbers of every kind are written in a locale that is written, with and without written options; the receiver is a number, a Number object, a BigInt
function plain(n) { return n.toLocaleString("en-US"); }
function german(n) { return n.toLocaleString("de-DE"); }
function percent(n) { return n.toLocaleString("en-US", { style: "percent" }); }
function digits(n) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function badLocale(n) { return n.toLocaleString("not a locale"); }
function tell(f, n) { try { return f(n); } catch (e) { return e.name; } }
const numbers = [0, -0, 1, -1, 0.5, 1234.5678, 1e21, 2 ** 53 + 2, 1e-7, NaN, Infinity, -Infinity, 999999.995, new Number(5), 12345678901234567890n];
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < numbers.length; i++)
    console.log(String(numbers[i]), tell(plain, numbers[i]), tell(german, numbers[i]), tell(percent, numbers[i]), tell(digits, numbers[i]), tell(badLocale, numbers[i]));
}
