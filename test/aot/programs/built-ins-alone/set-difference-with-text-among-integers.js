const set = new Set([1, 2]);
const first = new Set([1, 2]);
const result = set.difference(first);
console.log(result instanceof Set, result.size);
