// Two values of unknown kinds compared with === and !==, as a branch and as a value, every pair in both orders.
"use strict";
const text = "te" + String(process.argv.length > 100) + "xt", rope = (n) => "a".repeat(n) + "b" + n;
const object = { value: 1 }, symbol = Symbol("s"), func = function named() {};
const values = [
  undefined, null, true, false, 0, -0, 1, -1, 2147483647, -2147483648, 4294967296, 0.5, -0.5, NaN, Infinity, -Infinity, 1e308, 5e-324, 2 ** 53,
  "", "a", "b", text, "te" + "falsext", rope(3), rope(3), rope(40), rope(40), "aaab3", "Āx", "Ā" + "x", "0", "null", "undefined", "NaN",
  0n, -0n, 1n, -1n, 2n ** 64n, 2n ** 64n + 1n, BigInt("18446744073709551616"), -(2n ** 70n), BigInt(Number.MAX_SAFE_INTEGER),
  symbol, Symbol("s"), Symbol.for("s"), Symbol.iterator,
  object, { value: 1 }, [], [1], func, function named() {}, () => 1, class {}, new Proxy(object, {}), new Map(), new Date(0), /a/, new String("a"), new Number(0), Object(1n), Object.create(null), globalThis, Math, new Uint8Array(2), new Error("e"),
];
function branch(left, right) { if (left === right) return "="; return "#"; }
function negated(left, right) { if (left !== right) return "#"; return "="; }
function value(left, right) { return left === right; }
function ofField(holder, right) { return holder.field === right ? "=" : "#"; }
function ofFields(left, right) { return left.field === right.other || left.other === right.field ? "=" : "#"; }
function either(left, a, b, c) { if (left === a || left === b || left === c) return 1; else if (left === values[0] && a !== b) return 2; return 3; }
let sum = 0, line = "";
for (let i = 0; i < values.length; i++) {
  line = "";
  for (let j = 0; j < values.length; j++) {
    const same = branch(values[i], values[j]);
    if (negated(values[i], values[j]) !== same || (value(values[i], values[j]) ? "=" : "#") !== same || ofField({ field: values[i] }, values[j]) !== same) line += "!";
    line += same + ofFields({ field: values[i], other: i }, { other: values[j], field: {} });
    sum += either(values[j], values[i], values[(i + 1) % values.length], values[(j + i) % values.length]) * (i + 1);
  }
  console.log(line);
}
console.log(sum, Object.is(value(NaN, NaN), false));
function missing(a) { return a.x === a.y; }
console.log([{}, { x: 1 }, { x: undefined }, { x: null, y: undefined }, "text", 5, [], func].map(missing).join());
