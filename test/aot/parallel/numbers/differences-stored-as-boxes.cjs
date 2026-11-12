"use strict";
// STATISTIC: BoxedDifferences >= 4
// x - n of an unknown x and a whole number, stored into fields and variables, passed and returned.
function Reader(size) { this.size = size; this.position = 0; }
Reader.prototype.take = function (code) { const length = code >> 4; this.size = this.size - length; this.position = this.position - (length & 3); return code & 15; };
Reader.prototype.back = function (n) { this.position = (n | 0) - this.position; return this; };
let rest = 0;
function less(value) { rest = value - 1; return rest; }
function from(value) { return 2147483647 - value; }
function below(value) { return value - -2147483648; }
const answers = [];
const shown = (value) => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value);
const say = (make) => { try { answers.push(shown(make())); } catch (error) { answers.push(error.name); } };
const values = [0, -0, 1, -1, 0.5, 1e300, NaN, Infinity, 2147483647, -2147483648, 4294967295, 2 ** 53, "12", "", "x", null, undefined, true, false, [], [3], {}, { valueOf() { answers.push("ran"); return 9; } }, 5n, Symbol.iterator, new Date(7)];
for (const value of values) { say(() => less(value)); say(() => from(value)); say(() => below(value)); say(() => { const reader = new Reader(value); reader.take(0x57); reader.take(0x130); return shown(reader.size) + "," + shown(reader.position); }); say(() => { const reader = new Reader(1); reader.position = value; return shown(reader.back(-7).position) + "," + shown(reader.back(0).position); }); }
const frozen = Object.freeze(new Reader(5)); say(() => frozen.take(16));
const odd = new Reader(5); Object.defineProperty(odd, "size", { get() { return 40; }, set(value) { answers.push("set " + value); } }); say(() => odd.take(0x35));
for (let i = 0; i < 50; i++) { const reader = new Reader(i * 1.5); reader.take(i << 3); say(() => reader.size); }
console.log(answers.join(" "));
