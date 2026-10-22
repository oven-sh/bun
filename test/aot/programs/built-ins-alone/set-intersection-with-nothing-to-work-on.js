const set = new Set();
const first = new Set();
const result = set.intersection(first);
console.log(result instanceof Set, result.size);
