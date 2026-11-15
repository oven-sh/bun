// One function with `options = {}`, called through a table by turns with the literal that its use expects, with nothing, with what was parsed, with another literal and with an object without a prototype,
// in a loop long enough for every site to be filled; and the same function called directly, where the callee is copied into the loop.
"use strict";
function shape(width, options = {}) { const label = options.label === undefined ? "" : options.label; return width + label.length + (options.edge === undefined ? 1 : 0) + (options.depth | 0) + (options.tint ? 1 : 0); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const parsed = JSON.parse('{"label":"pp","depth":3,"edge":1}'), bare = Object.assign(Object.create(null), { label: "bbb", tint: 1 });
const sums = [0, 0, 0, 0, 0, 0];
for (let i = 0; i < 3000; i++) {
  const h = table[key], k = i % 5;
  sums[k] += k === 0 ? h(i, { label: "q", depth: i }) : k === 1 ? h(i) : k === 2 ? h(i, parsed) : k === 3 ? h(i, { tint: i & 1 }) : h(i, bare);
  sums[5] += shape(i, { label: "q", depth: i }) + shape(i);
}
console.log(sums.join(" "));
