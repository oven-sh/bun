// WeakMaps and WeakSets grow past the buffer in the cell, lose most keys to collections, grow again, and are made anew between collections.
const kept = [];
const maps = [];
let sum = 0;
for (let round = 0; round < 60; round++) {
  const map = new WeakMap();
  const set = new WeakSet();
  maps.push(map, set);
  if (maps.length > 12) maps.splice(0, 2);
  for (let i = 0; i < 3000; i++) {
    const key = { i };
    map.set(key, i);
    set.add(key);
    if (i % 500 === 0) kept.push(key);
    for (const older of maps) if (older !== map && older !== set && i % 700 === 0) older instanceof WeakMap ? older.set(key, round) : older.add(key);
  }
  if (round % 3 === 0) Bun.gc(true);
  for (const key of kept) for (const table of maps) if (table.has(key)) sum = (sum + key.i + 1) | 0;
  if (kept.length > 200) kept.splice(0, 100);
}
console.log(sum, kept.length);
