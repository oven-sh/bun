'use strict';
// Lists are stored into under numbers that are reckoned: some of them are no index and become names. Reads under such numbers run no code, and one that nothing has changed is not made again.
function fill(list, from, step, n) {
  let at = from;
  for (let i = 0; i < n; i++) { list[at] = i * 3; at = at + step; }
  return list;
}
function read(list, from, step, n) {
  let at = from, sum = 0, missing = 0;
  for (let i = 0; i < n; i++) {
    const x = list[at];
    if (x === undefined) missing++; else sum += x + list[at];
    at = at + step;
  }
  return sum + '/' + missing;
}
function again(list, at, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) { sum += (list[at] || 0) + (list[at] || 0); if (i === n - 2) list[at] = .25; }
  return sum;
}
const ways = [[0, 1], [0, .5], [-2, 1], [3, -1], [1.25, 1], [4294967293, 1], [2147483645, 1], [0, 1e9], [-0, 0], [NaN, 1], [Infinity, 1], [1e21, 1e20], [.1, .2]];
for (const [from, step] of ways) {
  const list = fill([], from, step, 8), long = fill([7, 8, 9], from, step, 8), parts = fill([.5, 1.5], from, step, 5);
  console.log(String(from), String(step), list.length, Object.keys(list).join(), read(list, from, step, 10), read(long, from, step, 10), read(parts, -1, .5, 12), again(list, from, 9), again(parts, from + step, 4), list[from], parts[from + step], list.length < 20 ? JSON.stringify(list) : Object.values(list).join());
}
const named = [1, 2, 3];
Object.defineProperty(named, '1.5', { get() { return 1000; }, configurable: true, enumerable: true });
console.log(read(named, 0, .5, 5), again(named, 2, 3));
try { fill(named, .5, .5, 4); console.log(Object.keys(named).join()); } catch (e) { console.log(e.constructor.name); }
Object.setPrototypeOf(named, { __proto__: Array.prototype, '-1': 50 });
console.log(read(named, -1, .5, 6), read(Object.freeze([1, , 3]), -1, .5, 8));
try { fill(Object.freeze([4]), 0, .5, 3); } catch (e) { console.log(e.constructor.name); }
