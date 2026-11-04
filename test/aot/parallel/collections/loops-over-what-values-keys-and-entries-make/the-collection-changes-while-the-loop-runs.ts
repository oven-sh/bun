// An iterator of a Map or a Set is live: what is added is come to, what is deleted is passed over, a cleared table ends the loop unless something is added.
const log: string[] = [];
let map = new Map<number, string>([[1, "a"], [2, "b"], [3, "c"]]);
for (const value of map.values()) { log.push(value); if (value === "a") { map.delete(2); map.set(4, "d"); } if (value === "d" && map.size < 6) map.set(map.size + 10, "late"); }
console.log(log.join()); log.length = 0;
map = new Map([[1, "a"], [2, "b"], [3, "c"]]);
for (const key of map.keys()) { log.push(String(key)); if (key === 1) { map.clear(); map.set(9, "z"); } }
console.log(log.join()); log.length = 0;
map = new Map([[1, "a"], [2, "b"]]);
for (const [key, value] of map.entries()) { log.push(key + value); if (key === 1) { map.delete(1); map.set(1, "again"); } if (log.length > 6) break; }
console.log(log.join()); log.length = 0;
map = new Map(); for (let i = 0; i < 200; i++) map.set(i, "v" + i);
let seen = 0; for (const key of map.keys()) { seen++; if (key % 2 === 0) map.delete(key + 1); if (key === 100) for (let i = 1000; i < 1400; i++) map.set(i, "grown"); }
console.log(seen, map.size);
const set = new Set([1, 2, 3]);
for (const value of set.values()) { log.push(String(value)); if (value < 3) set.add(value + 10); if (value === 2) set.delete(3); }
console.log(log.join()); log.length = 0;
let other = new Map([["x", 1]]); let current = new Map([["a", 1], ["b", 2]]);
for (const key of current.keys()) { log.push(key); current = other; }
console.log(log.join(), current === other);
