'use strict';
// A value of unknown kind enters a loop and numbers come round: the version of the loop asks once, in front, whether it is a number.
const log = [];
const speaks = n => ({ valueOf() { log.push(n); return n; } });
function shrink(x, n) { for (let i = 0; i < n; i++) x = x / 2 + 1; return x; }
function count(x, n) { let steps = 0; for (; x > 1 && steps < n; steps++) x = x % 2 === 0 ? x / 2 : x - 1; return steps + ':' + x; }
function carry(x, list) { let last = x, sum = 0; for (let i = 0; i < list.length; i++) { sum += last * list[i]; last = list[i] - last; } return sum + ':' + last; }
function swap(x, y, n) { for (let i = 0; i < n; i++) { const t = x; x = y - 1; y = t * 1; } return x + ':' + y; }
function nested(x, n) { let r = 0; for (let i = 0; i < n; i++) { let y = x; for (let j = 0; j < 3; j++) { y = y * .5; r += y; } x = y + i; } return r + ':' + x; }
function steps(x, n) { for (let i = 0; i < n; i++) { if (i % 3 === 0) x++; else x -= .5; } return x; }
const values = [0, -0, 1, 7, 1e9, 2147483647, .5, -3.25, NaN, Infinity, undefined, null, true, '12', 'x', '', [4], [1, 2], {}, 5n, Symbol.iterator, () => 1];
for (const f of [x => shrink(x, 9), x => count(x, 20), x => carry(x, [1, 2, 3.5, -4]), x => carry(x, []), x => swap(x, 3, 5), x => swap(2, x, 4), x => nested(x, 4), x => steps(x, 7), x => steps(x, 0)]) {
  const said = [];
  for (const value of values) { let r; try { r = f(value); } catch (e) { r = e.constructor.name; } said.push(Object.is(r, -0) ? '-0' : typeof r === 'object' || typeof r === 'function' ? typeof r : String(r)); }
  log.length = 0;
  let spoken;
  try { spoken = f(speaks(6)); } catch (e) { spoken = e.constructor.name; }
  console.log(said.join(' '), '|', typeof spoken === 'object' ? 'object' : spoken, log.length);
}
