// One entry in a thousand of a large Map and of a large Set is left, and both still answer like small ones.
// Flags: --aot-validate
const count = 1 << 17;
const map = new Map<number, number>();
const set = new Set<number>();
for (let index = 0; index < count; index++) {
  map.set(index, index * 2);
  set.add(index);
}
console.log("filled", map.size, set.size);

let deleted = 0;
for (let index = 0; index < count; index++) {
  if (index % 1000 !== 0 && map.delete(index) && set.delete(index)) deleted++;
}
console.log("deleted", deleted, map.size, set.size);

let sum = 0;
for (const [key, value] of map) sum += value - key;
let keys = 0;
for (const key of set) keys += key;
console.log("left", sum, keys, map.has(1000), map.has(1001), set.has(2000), set.has(2001), map.get(count - 72));
