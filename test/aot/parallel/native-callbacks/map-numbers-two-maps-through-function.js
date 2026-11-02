// One function reads a Map of small integers, a Map of fractions and large numbers, and a Map made of a literal array of pairs.
const log = [];
const small = new Map(Object.entries({ a: 1 })), wide = new Map(); wide.set("a", 1.5); wide.set("b", 2 ** 40);
function read(map, key) { const found = map.get(key); return found === undefined ? -1 : found + found; }
log.push(read(small, "a"), read(wide, "a"), read(wide, "b"), read(small, "b"), read(new Map([["a", 2 ** 31]]), "a"));
console.log(log.join("; "));
