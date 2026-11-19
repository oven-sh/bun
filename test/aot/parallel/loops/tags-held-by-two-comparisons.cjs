// Loops that ask two boxed values for their kind, with few and with many values alive, calls on their rare ways, and loops inside.
"use strict";
class Stack { #list = []; push(x) { this.#list.push(x); } pop() { return this.#list.pop(); } get size() { return this.#list.length; } }
const mixed = [1, 2.5, -0, "s", null, undefined, true, {}, [], 2147483647, -2147483648, NaN, 4294967296, Symbol.iterator, () => 1, 7];
const ints = Array.from({ length: 64 }, (_, k) => k - 20), halves = ints.map((k) => k / 2), texts = ints.map((k) => (k % 3 ? k : "t" + k));
const add = (a, b) => (typeof a === "number" ? a : 1) + (typeof b === "number" ? b : 2);
function pops(stack, turns) { let n = 0; for (let k = 0; k < turns; k++) { stack.push(k & 7); stack.push(k % 5 ? 1 : mixed[k % 3]); n += +stack.pop() + stack.pop() + stack.size; } return n; }
function pairs(a, b) { let n = 0, other = 0; for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; if (typeof x === "number" && typeof y === "number") n += x * y; else other += add(x, y); } return [n, other]; }
function many(a, b, c, d, e, f) { let s = 0, t = 0, u = 1, v = 2, w = 3; for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; s += typeof x === "number" ? x : c; t += typeof y === "number" ? y : d; u = (u * 3 + k) % 1009; v = v + e - f; w = w ^ (k * 31); if (x === y) t -= u; } return [s, t, u, v, w, c, d, e, f]; }
function nested(rows) { let n = 0; for (let i = 0; i < rows.length; i++) { const row = rows[i]; for (let j = 0; j < row.length; j++) { const x = row[j], y = row[row.length - 1 - j]; if (x === undefined || y === null) continue; n += (typeof x === "number" ? x : 0) - (typeof y === "number" ? y : 1); } } return n; }
function cells(list) { let n = 0; for (const x of list) { if (typeof x === "object" && x !== null) n += 1; else if (typeof x === "string") n += x.length; else if (typeof x === "function") n += 10; else if (x === true) n += 100; } return n; }
function thrown(list) { let n = 0; for (let k = 0; k < list.length; k++) { try { const x = list[k], y = list[(k + 1) % list.length]; n += x.valueOf() === x ? 1 : 2; n += typeof y === "number" ? y | 0 : 0; } catch (error) { n += error.name.length; } } return n; }
function* steps(list) { for (let k = 0; k < list.length; k++) { const x = list[k], y = list[list.length - 1 - k]; if (typeof x === "number" && typeof y === "number") yield x + y; } }
for (let turn = 0; turn < 40; turn++) {
  const line = [pops(new Stack(), 50 + turn), pairs(ints, halves), pairs(texts, ints), pairs(mixed, mixed), many(ints, texts, 1, 2, 3, 4), many(mixed, mixed, 0.5, -0, 1e9, 2), nested([ints, texts, mixed, halves, []]), cells(mixed), thrown(mixed), [...steps(texts)].length, [...steps(mixed)].length];
  if (turn % 13 == 0) console.log(line.join(" "));
}
