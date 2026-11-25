// STATISTIC: NumbersFoundAtHomeSlots <= 2
// A remainder or mask of a product or of shifted bits is not looked for at its own place; one of a counter is.
"use strict";
function product(map, n) { let sum = 0; for (let i = 0; i < n; i++) { const key = (i * 37) % 701; let value = map.get(key); if (value === undefined) { value = key * 2; map.set(key, value); } sum += value; } return sum; }
function bits(map, n) { let sum = 0; for (let i = 0; i < n; i++) sum += map.get((i ^ 21) & 127) ?? 1; return sum; }
function shifted(set, n) { let found = 0; for (let i = 0; i < n; i++) if (set.has((i << 3) % 1000)) found++; return found; }
function masked(map, n) { let sum = 0; for (let i = 0; i < n; i++) sum += map.get(i & 63) ?? 2; return sum; }
function remainder(map, n) { let sum = 0; for (let i = 0; i < n; i++) sum += map.get((i + 3) % 50) ?? 3; return sum; }
for (const size of [0, 1, 8, 9, 60, 300, 900]) {
  const map = new Map(), set = new Set(), other = new Map();
  for (let i = 0; i < size; i++) { map.set((i * 37) % 701, i); set.add(i * 5); other.set(i, i / 2); }
  console.log(size, product(map, 2000), map.size, bits(map, 500), bits(other, 500), shifted(set, 700), masked(other, 400), masked(map, 400), remainder(other, 333), remainder(map, 333));
  map.delete(37); other.delete(0); console.log(product(map, 900), bits(other, 300), masked(other, 200), remainder(other, 99));
}
