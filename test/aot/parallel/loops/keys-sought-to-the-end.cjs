// STATISTIC: CollectionLookupsByTag >= 12
// Lookups of numbers and objects in loops: full groups of slots, keys of the same tag, deleted keys, few entries, no table, tables of mixed keys.
"use strict";
function gets(map, from, to, step) { let sum = 0, missed = 0; for (let i = from; i < to; i++) { const found = map.get(i * step + 3); if (found === undefined) { missed++; continue; } sum = (sum * 31 + found) % 1000003; } return sum + ":" + missed; }
function sums(map, from, to, step) { let sum = 0; for (let i = from; i < to; i++) sum += map.get(i * step + 3); return sum; }
function has(set, from, to, step) { let sum = 0, found = 0; for (let i = from; i < to; i++) if (set.has(i * step + 3)) { found++; sum = (sum * 31 + i) % 1000003; } return sum + ":" + found; }
function both(map, from, to, step) { let sum = 0; for (let i = from; i < to; i++) { const key = i * step + 3; if (map.has(key)) sum += map.get(key); } return sum; }
function halves(map, to) { let sum = 0, missed = 0; for (let i = 0; i < to; i++) { const found = map.get(i / 2); if (found === undefined) missed++; else sum += found; } return sum + ":" + missed; }
function objects(map, set, keys) { let sum = 0, n = 0; for (let i = 0; i < keys.length; i++) { const found = map.get(keys[i]); if (found !== undefined) sum += found; if (set.has(keys[i])) n++; } return sum + ":" + n; }
function moved(map, to, step) { let n = 0; for (let i = 0; i < to; i++) { const key = i * step + 3; if (!map.has(key)) { map.set(key, i); n++; } else if (i % 7 === 3) map.delete(key); if (map.get(key) === undefined) n += 1000; } return n; }
function anything(map, keys) { let n = 0; for (const key of keys) { if (map.has(key)) n++; const found = map.get(key); if (found !== undefined) n += 10; } return n; }
const things = Array.from({ length: 9000 }, (_, i) => ({ i }));
for (const size of [0, 1, 7, 8, 9, 14, 255, 1100, 5000, 14000]) {
  for (const step of [1, 7, 1 << 16]) {
    const map = new Map(), set = new Set(), half = new Map(), byThing = new Map(), thingSet = new Set(), mixed = new Map();
    for (let i = 0; i < size; i++) {
      map.set(i * step + 3, i); set.add(i * step + 3); half.set(i / 2 + step, i);
      if (i < 9000 && i % 3) { byThing.set(things[i], i); thingSet.add(things[i]); }
      if (i < 300) mixed.set(i % 4 === 0 ? i : i % 4 === 1 ? "t" + i : i % 4 === 2 ? things[i] : i / 8, i);
    }
    const line = () => [gets(map, 0, 2 * size + 5, step), sums(map, 0, size, step), has(set, 0, 2 * size + 5, step), both(map, -3, size + 9, step), halves(half, size + 40), objects(byThing, thingSet, things.slice(0, size + 5)), anything(mixed, [0, 4, 8, 1, "t1", "t2", things[2], things[6], 0.375, NaN, null, undefined, -0])].join(" ");
    console.log(size, step, line());
    for (let i = 0; i < size; i += 3) { map.delete(i * step + 3); set.delete(i * step + 3); half.delete(i / 2 + step); }
    for (let i = 0; i < size; i += 5) if (i < 9000) { byThing.delete(things[i]); thingSet.delete(things[i]); }
    console.log(line());
    console.log(moved(map, size + 20, step), moved(map, size + 20, step), line());
    map.clear(); set.clear(); console.log(gets(map, 0, 20, step), has(set, 0, 20, step), sums(map, 0, 1, step));
  }
}
