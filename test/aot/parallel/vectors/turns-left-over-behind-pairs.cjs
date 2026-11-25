// Loops that are computed in pairs leave turns over: rows of odd widths, turns that end early, rows that a condition leaves, and what follows the last pair.
"use strict";
const bits = new DataView(new ArrayBuffer(8));
const show = v => { if (typeof v !== "number") return String(v); if (v !== v) return "NaN"; bits.setFloat64(0, v); return (bits.getUint32(0) ^ bits.getUint32(4)).toString(36); };
const said = list => Array.from(list, show).join(" ");
function lifted(to, from, n) { for (let i = 0; i < n; i++) to[i] = from[i] * 1.5 + 0.25; return to; }
function upTo(to, from, n, limit) { let i = 0; for (; i < n; i++) { const v = from[i] - 0.5; if (v > limit) break; to[i] = v; } return i; }
function rowsUpTo(grid, width, height, k) { for (let y = 0; y < height; y++) { const at = y * width; for (let x = 0; x < width - 1; x++) grid[at + x] = grid[at + x] * 0.5 + grid[at + x + 1] * k; if (grid[at] > 40) return y; } return height; }
function everyThird(to, from, n) { for (let i = 0; i + 2 < n; i += 3) { to[i] = from[i] + from[i + 2]; to[i + 1] = from[i + 1] * 0.5; } return to; }
function down(to, from, n) { for (let i = n - 1; i >= 0; i--) to[i] = from[i] / 4 - i; return to; }
function summed(from, n) { let sum = 0, least = Infinity; for (let i = 0; i < n; i++) { sum += from[i] * 0.125; if (from[i] < least) least = from[i]; } return sum + least; }
function twice(to, from, n) { for (let i = 0; i < n; i++) { to[i] = from[i] * from[i]; } for (let i = n & ~1; i < n; i++) to[i] = -to[i]; return to; }
const numbers = n => Array.from({ length: n }, (_, i) => i * 0.75 - (i % 3));
const makers = { lists: numbers, whole: n => Array.from({ length: n }, (_, i) => (i * 7) % 10), doubles: n => Float64Array.from(numbers(n)), floats: n => Float32Array.from(numbers(n)), bytes: n => Uint8Array.from(numbers(n)), holes: n => { const list = numbers(n); delete list[1]; delete list[n - 1]; return list; }, mixed: n => numbers(n).map((v, i) => (i === 2 ? "2" : i === 5 ? null : v)) };
for (const [name, make] of Object.entries(makers)) {
  for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 31]) {
    const from = make(n), out = [];
    out.push(said(lifted(make(n), from, n)), upTo(make(n), from, n, 6), said(everyThird(make(n), from, n)), said(down(make(n), from, n)), show(summed(from, n)), said(twice(make(n), from, n)));
    console.log(name, n, out.join(" | "));
  }
  for (const [w, h] of [[1, 5], [2, 3], [3, 4], [5, 5], [7, 2], [8, 3]]) { const grid = make(w * h + 1); console.log(name, w, h, rowsUpTo(grid, w, h, 2.5), rowsUpTo(grid, w, h, 9), said(grid)); }
  // More turns than there are elements, and lists that are the same.
  const short = make(5); console.log(said(lifted(make(5), short, 8)), said(lifted(short, short, 7)), upTo(short, short, 20, 1e9));
}
const frozen = Object.freeze(numbers(6)); try { lifted(frozen, numbers(6), 6); } catch (error) { console.log(error.constructor.name, said(frozen)); }
const resized = new ArrayBuffer(32, { maxByteLength: 128 }), tracking = new Float64Array(resized); tracking.fill(2); resized.resize(56); console.log(said(lifted(tracking, numbers(9), 9)), tracking.length); resized.resize(8); console.log(said(lifted(tracking, numbers(9), 9)), show(summed(tracking, 4)));
let order = []; const asked = numbers(4); Object.defineProperty(asked, 2, { get() { order.push("get"); return 1.25; }, set(v) { order.push("set"); } }); console.log(said(twice(numbers(4), asked, 4)), said(lifted(asked, numbers(4), 4)), order.join());
