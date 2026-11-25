// The key of each read is a constant that holds Symbol.iterator: the read goes by that name, as Array.prototype[Symbol.iterator] written out does. No other member of the holders is compiled.
// STATISTIC: ImageFunctionsEmitted <= 12
const stepsKey = Symbol.iterator;
const walkOfLists = Array.prototype[stepsKey];
console.log(typeof walkOfLists, [...walkOfLists.call([3, 1, 2])].join());
console.log(Map.prototype[stepsKey] === Map.prototype.entries, Set.prototype[stepsKey] === Set.prototype.values);
