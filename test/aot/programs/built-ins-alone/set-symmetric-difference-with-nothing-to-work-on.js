const set = new Set();
const first = new Set();
const result = set.symmetricDifference(first);
console.log(result instanceof Set, result.size);
