// Array.prototype.toSorted with a comparator is a function of the same file of Bun's library as sort, and falls back on the built-in under its own name. The executable holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 48
console.log([1, 2, 3].toSorted((a, b) => b - a).join(), [3, 1, 2].sort().join());
