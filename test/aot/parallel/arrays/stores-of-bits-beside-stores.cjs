// STATISTIC: BitStoresNearStores >= 1
// Arrays of which a loop takes bits alone, and into which it stores twice: int32s, doubles, holes, other values, aliases.
"use strict";
const own = a => { let s = a.length + ":"; for (let k = 0; k < a.length; k++) s += Object.prototype.hasOwnProperty.call(a, k) ? String(a[k]) + "," : "_,"; return s; };
const given = new Map(); given.set("n", 12);
function search(n, first) { let last = []; let r = 0; for (let i = 0; i < 6; i++) { const bits = Array(n + 2); bits[n + 1] = (1 << i) - 1; if (i === 2) bits[0] = first; for (let j = n; j >= 1; j -= 1) { bits[j] = (bits[j + 1] << 1 | 1) & 255; if (i) bits[j] |= (last[j + 1] | last[j]) << 1 | 1 | last[j + 1]; if (bits[j] & 64) r++; } last = bits; } return r + own(last); }
function mix(a, b, n) { let r = 0; for (let j = 1; j < n; j++) { a[j] = b[j - 1] ^ j; a[j] |= b[j] << 1; if (a[j] & 4) r++; } return r + own(a) + own(b); }
const kinds = [() => new Array(10), () => Array.from({ length: 10 }, (_, i) => i * 5), () => Array.from({ length: 10 }, (_, i) => i + 0.5), () => Array.from({ length: 10 }, (_, i) => i * 2 ** 29), () => [1, , 3, , 5, , 7, , 9, 10], () => Array.from({ length: 10 }, (_, i) => i === 4 ? "6" : i), () => Array.from({ length: 10 }, (_, i) => i === 5 ? { valueOf() { return 3; } } : i), () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])];
for (let round = 0; round < 3; round++) {
  for (const first of [1, 0.5, "q", undefined, { }]) console.log(search(given.get("n"), first));
  for (const x of kinds) for (const y of kinds) { let r; try { r = mix(x(), y(), 9); } catch (e) { r = e.constructor.name; } console.log(r); }
  for (const x of kinds) { const a = x(); let r; try { r = mix(a, a, 9); } catch (e) { r = e.constructor.name; } console.log(r); }
}
