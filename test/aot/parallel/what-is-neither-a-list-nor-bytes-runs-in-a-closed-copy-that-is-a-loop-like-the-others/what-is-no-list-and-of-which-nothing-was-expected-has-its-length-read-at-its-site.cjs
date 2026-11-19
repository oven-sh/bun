'use strict';
const made = process.argv.length > 9 ? process.argv[9] : '{' + Array.from({ length: 40 }, (_, i) => '"' + i + '":' + (i + 0.5)).join() + ',"length":40,"size":40}';
const holder = JSON.parse(made);
function sumOf(t) { let sum = t & 1; for (let i = 0; i < holder.length; i++) sum = sum + holder[i] * 2; return sum; }
let reads = 0;
const others = [
  [1.5, 2.5, 3.5],
  'a text',
  new Uint8Array([1, 2, 3, 4]),
  { get length() { reads++; return 3; }, 0: 1, 1: 2, 2: 3 },
  new Proxy({ 0: 4, 1: 5, length: 2 }, { get(target, key) { reads++; return target[key]; } }),
  (function () { return arguments; })(7, 8, 9),
  Object.create({ length: 2, 0: 10, 1: 11 }),
  { length: '2', 0: 1, 1: 2, 2: 3 },
  { 0: 1 },
  function (a, b) {},
];
let other = others[0];
function sumOfOther(t) { let sum = t & 1; for (let i = 0; i < other.length; i++) sum = sum + other[i] * 2; return sum; }
const said = [];
for (let t = 0; t < 4; t++) said.push(sumOf(t));
for (const each of others) { other = each; said.push(String(sumOfOther(1))); }
holder.length = 3;
said.push(sumOf(0));
delete holder.length;
said.push(sumOf(0), reads);
console.log(said.join(' '));
