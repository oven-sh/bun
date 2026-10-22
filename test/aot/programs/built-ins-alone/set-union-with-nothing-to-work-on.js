const set = new Set();
const first = new Set();
const result = set.union(first);
console.log(result instanceof Set, result.size);
