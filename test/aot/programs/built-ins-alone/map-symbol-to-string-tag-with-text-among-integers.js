const map = new Map([["first", 1], ["second", 2]]);
const result = map[Symbol.toStringTag];
console.log(typeof result, result.length, result);
