const set = new Set();
const result = set.add(1.5);
console.log(result === set, set instanceof Set, set.size, set.has(1.5));
console.log(typeof [...set][0], [...set][0] + 1);
