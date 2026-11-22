'use strict';
// STATISTIC: SumsTruncatedWithoutTests >= 2
// The bits of a sum of many integers are the bits of the sum in integers while no part of it is rounded. Terms of 2 ** 51 and more, fractions and NaN are added as numbers.
function five(a, b, c, d, e) { return (a | 0) + (b | 0) + (c | 0) + (d | 0) + (e | 0) | 0; }
function nine(l) { return (l[0] | 0) + (l[1] >>> 0) + (l[2] | 0) - (l[3] | 0) + (l[4] >>> 1) + (l[5] & 65535) + (l[6] | 0) + (l[7] | 0) + (l[8] | 0) >>> 0; }
function rolled(l, n) { let x = 7, y = 11; for (let i = 0; i < n; i++) { const t = (x << 3 | x >>> 29) + (x & y | ~x & i) + y + l[i] + 0x5bd1 | 0; y = x; x = t; } return x ^ y; }
function turned(l, n) { let x = 1, y = 2, z = 3; for (let i = 0; i < n; i++) { const t = (x << 9 | x >>> 23) + (y ^ z >>> 4) + (l[i] | 0) + (l[i + 1] >>> 0) + i * 3 | 0; z = x - y | 0; y = t ^ z; x = y + (z << 2) | 0; } return [x, y, z].join(); }
function doubled(l, n) { let x = 9; for (let i = 0; i < n; i++) x = x + (x << 10) + (l[i] ^ x >>> 6) + (l[i] | 0) + l[i] >>> 0; return x; }
function open(a, b, c, d) { return a + b + c + d | 0; }
function loose(l) { let x = 0; for (let i = 0; i < l.length; i++) x = x + l[i] + (l[i] | 0) + i | 0; return x; }
function scaled(l) { let x = 1; for (let i = 0; i < l.length; i++) x = x * 5 + (l[i] | 0) + (l[i] >>> 3) + i + (x >>> 7) | 0; return x; }
const values = [0, -0, 1, -1, 2147483647, -2147483648, 4294967295, 2 ** 51, 2 ** 52 + 1, -(2 ** 53), 2 ** 53 + 2, 1e16, .5, -2.75, 1e300, NaN, Infinity, undefined, null, '12', 'z', true, {}, [3]];
for (const a of values) {
  const said = [];
  for (const b of values) said.push(five(a, b, 2147483647, b, a), open(a, b, 1, 2), open(2 ** 52, a, b, -1));
  console.log(String(a), said.join());
}
for (let k = 0; k < values.length; k++) {
  const l = Array.from({ length: 12 }, (_, i) => values[(i * 5 + k) % values.length]), whole = l.map((x, i) => (i * 715827882 + k * 99) | 0), big = whole.map(x => x * 2 ** 20 + k);
  const said = [];
  for (const list of [l, whole, big, new Int32Array(whole), new Uint32Array(whole), new Float64Array(big)]) said.push(nine(list), rolled(list, 12), rolled(list, 14), turned(list, 11), doubled(list, 12), loose(list), scaled(list));
  console.log(k, said.join(' '));
}
try { five(1n, 2, 3, 4, 5); } catch (e) { console.log(e.constructor.name); }
try { console.log(open(1n, 2n, 3n, 4n)); } catch (e) { console.log(e.constructor.name); }
