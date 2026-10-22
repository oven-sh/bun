const map = new Map();
const result = map[Symbol.toStringTag];
console.log(typeof result, result.length, result);
