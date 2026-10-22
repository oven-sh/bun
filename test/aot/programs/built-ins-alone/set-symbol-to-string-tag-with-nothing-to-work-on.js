const set = new Set();
const result = set[Symbol.toStringTag];
console.log(typeof result, result.length, result);
