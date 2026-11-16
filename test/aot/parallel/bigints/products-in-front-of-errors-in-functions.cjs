// In the scope of a function: the error of a product comes in front of what stands between it and the remainder: a constant that is not initialized yet, a divisor that a getter or a call gives, an object that is null.
(function (exports) {
"use strict";
function mod(a, b = CURVE.P) { const result = a % b; return result >= 0n ? result : b + result; }
function line(x, y) { return mod(x * y); }
function under(x, y) { const product = x * y; return product % divisor; }
function ofRecord(x, y, record) { const product = x * y; return product % record.P >= 0n; }
function ofCall(x, y, f) { const product = x * y; return product % f() >= 0n; }
function ofList(x, y, list, index) { const product = x * y; return product % list[index] >= 0n; }
const say = f => { try { return String(f()); } catch (error) { return error.name; } };
const pairs = [[1n, 2], [2, 3n], [3n, 4n], [5, 6], ["7", 8n], [Symbol.iterator, 9n], [undefined, 10n], [{ valueOf() { return 11n; } }, 12n]];
console.log(pairs.map(([x, y]) => say(() => line(x, y))).join(" "));
console.log(pairs.map(([x, y]) => say(() => under(x, y))).join(" "));
const CURVE = Object.freeze({ P: (1n << 255n) - 19n });
let divisor = (1n << 255n) - 19n;
for (let turn = 0; turn < 3; turn++) {
  let reads = 0;
  const record = turn === 2 ? null : turn ? { get P() { reads++; return CURVE.P; } } : { P: CURVE.P };
  const list = turn === 2 ? undefined : turn ? new Proxy([], { get() { reads++; return CURVE.P; } }) : [CURVE.P];
  for (const [x, y] of pairs)
    console.log(say(() => line(x, y)), say(() => under(x, y)), say(() => ofRecord(x, y, record)), say(() => ofCall(x, y, () => { reads++; return CURVE.P; })), say(() => ofList(x, y, list, 0)), reads);
  divisor = turn ? "x" : 7n;
}
let sum = 0n;
for (let i = 0n; i < 400n; i++) sum = line(sum + i, sum * sum % CURVE.P + (1n << 254n));
console.log(sum.toString(16));

let late = 0;
function early(x, y) { const product = x * y; return product % LATE >= 0n; }
function earlyInLoop(x, y, n) { let count = 0; for (let i = 0; i < n; i++) { const product = x * y; if (product % LATE >= 0n) count++; x = -x; } return count; }
console.log(pairs.map(([x, y]) => say(() => early(x, y)) + say(() => earlyInLoop(x, y, 3))).join(" "));
const LATE = CURVE.P;
console.log(pairs.map(([x, y]) => say(() => early(x, y)) + say(() => earlyInLoop(x, y, 3))).join(" "));
for (let i = 0n; i < 300n; i++) late += earlyInLoop(i, sum, 4);
console.log(late);
exports.line = line; exports.CURVE = CURVE;
})(module.exports);
