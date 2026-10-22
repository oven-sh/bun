const set = new Set([1, 2]);
const result = set[Symbol.toStringTag];
console.log(typeof result, result.length, result);
