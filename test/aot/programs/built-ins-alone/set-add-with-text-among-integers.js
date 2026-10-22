const set = new Set([1, 2]);
const result = set.add("text");
console.log(result === set, set instanceof Set, set.size, set.has(1), set.has(2));
console.log(typeof [...set][2], [...set][2].length, [...set][2]);
