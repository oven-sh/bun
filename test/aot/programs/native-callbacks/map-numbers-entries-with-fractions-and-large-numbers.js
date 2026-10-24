// The literal whose entries fill the Map holds a fraction and numbers on both sides of the range of an int32.
const log = [];
const sizes = { small: 1, half: 0.5, large: 4294967296, negative: -2147483649 };
const map = new Map(Object.entries(sizes));
function twice(key) { const found = map.get(key); return found === undefined ? "none" : found * 2; }
log.push(twice("small"), twice("half"), twice("large"), twice("negative"), twice("x"), map.get("large") | 0, map.get("negative") >> 0);
console.log(log.join("; "));
