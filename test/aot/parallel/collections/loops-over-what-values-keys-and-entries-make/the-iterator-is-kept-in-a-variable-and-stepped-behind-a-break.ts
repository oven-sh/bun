// Whoever keeps the iterator sees where the loop has left it.
const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
const kept = map.values();
for (const value of kept) { console.log("in the loop", value); if (value === 2) break; }
console.log("behind the break", JSON.stringify(kept.next()), JSON.stringify(kept.next()), JSON.stringify(kept.next()));
const alone = map.values();
for (const value of alone) console.log("named once", value);
const keys = map.keys();
console.log(keys.next().value);
for (const key of keys) console.log("begun before the loop", key);
let held: IterableIterator<[string, number]> | undefined;
for (const [key, value] of (held = map.entries())) { console.log(key, value); if (key === "a") break; }
console.log(JSON.stringify(held!.next()));
function steps(values: IterableIterator<number>) { let sum = 0; for (const value of values) sum += value; return sum; }
console.log(steps(map.values()), [...map.values()].length);
