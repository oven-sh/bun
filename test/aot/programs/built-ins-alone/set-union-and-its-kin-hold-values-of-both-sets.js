const left = new Set([1.5, "two"]);
const right = new Set(["two", { three: 3 }]);
console.log([...left.union(right)][2].three + 1, [...left.intersection(right)][0].length);
console.log([...left.difference(right)][0] + 1, [...left.symmetricDifference(right)][1].three + 1);
