// Array.prototype.sort with a comparator is a file of Bun's library: sort hands the comparator to helpers of that file, and falls back on the built-in under the same name. The compiler does not follow the comparator there, and none of that is a sign of code that nobody compiles.
// STATISTIC: ImageFunctionsEmitted <= 48
const list = [{ rank: 3 }, { rank: 1 }, { rank: 2 }];
list.sort((a, b) => a.rank - b.rank);
console.log(list.map(item => item.rank).join());
