const set = new Set([1, 2]);
const first = new Set([1, 2]);
const result = set.intersection(first);
console.log(result instanceof Set, result.size, result.has(1), result.has(2));
console.log(typeof [...result][1], [...result][1] + 1);
