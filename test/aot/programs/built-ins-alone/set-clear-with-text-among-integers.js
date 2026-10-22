const set = new Set([1, 2]);
const result = set.clear();
console.log(typeof result, result === undefined, set instanceof Set, set.size);
