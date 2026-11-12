// STATISTIC: ReceivedLeavesDistinguished >= 1
// A captured variable or a parameter that holds one of a few small functions: a loop that calls it tells them apart.
const list = JSON.parse("[3, 1, 0.5, -2, 7, 100]");
let count = 0;
const square = v => 1 - v * v, half = v => v * 0.5, sign = v => v < 0 ? -1 : 1, counted = v => v + count++;
const all = [square, half, sign, counted];
class Grid {
  constructor() { this.rows = list.slice(); }
  each(callback) { for (let i = 0; i < this.rows.length; i++) callback.call(this, i); return this; }
}
function choose(kind) { return kind === 0 ? square : kind === 1 ? half : kind === 2 ? sign : counted; }
function make(f) { return function (i) { this.rows[i] = f(this.rows[i]); }; }
function sum(f, values) { let s = 0; for (let i = 0; i < values.length; i++) s += f(values[i]); return s; }
const ways = [0, 1, 2, 3].map(kind => make(choose(kind)));
for (let r = 0; r < 9; r++) console.log(new Grid().each(ways[r % 4]).rows.join(), sum(choose(r % 4), list));
for (const values of [["4", "x"], [undefined, null], [{ valueOf() { return ++count; } }], [NaN, -0, 9007199254740993], [2n]]) {
  for (let kind = 0; kind < 4; kind++) {
    try { console.log(kind, sum(choose(kind), values), count); } catch (error) { console.log(kind, error.name); }
  }
}
for (const f of all) console.log(sum(f, list), count);
