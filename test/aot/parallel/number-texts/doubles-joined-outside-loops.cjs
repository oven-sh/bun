// A double beside a text outside loops is converted by one stub: whole numbers, fractions, -0, NaN, the ends of the ranges.
"use strict";
const values = [0, -0, 1, -1, 9, 10, 63, 64, 255, 256, 1000, 1023, 1024, 65535, 65536, 2147483646, 2147483647, 2147483648, -2147483647, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e-7, 0.1, 0.5, -0.5, 1.5, 123456.789, 5e-324, 1.7976931348623157e308, Infinity, -Infinity, NaN];
class Meter { #total = 0; #count = 0; add(value) { this.#total += value; this.#count++; return this; } get total() { return this.#total; } text(unit) { return this.#total + unit; } both() { return this.#total / this.#count + "/" + this.#total; } template(unit) { return `${this.#total / 2} of ${this.#total}${unit}`; } key() { return { ["k" + this.#total * 0.25]: 1 }; } }
function half(x) { return x / 2 + " half"; }
function behind(x) { return "x" + x * 1.5; }
function between(a, b) { return "<" + a / 3 + "|" + b * 2 + ">"; }
function string(x) { return String(x / 4); }
function empty(x) { return "" + (x - 0.25); }
function integer(x) { return Math.floor(x / 8) + "i"; }
function once(value, unit) {
  const meter = new Meter().add(value).add(1);
  return [meter.text(unit), meter.both(), meter.template(unit), Object.keys(meter.key())[0], half(value), behind(value), between(value, meter.total), string(value), empty(value), integer(value)];
}
for (let turn = 0; turn < 60; turn++) {
  const lines = values.map((value) => once(value, turn % 2 ? "ms" : "").join(" "));
  if (turn % 20 == 0) console.log(lines.join("\n"));
}
