// The mapper of Array.from is called by a function of Bun's library that runs for every call of Array.from. The executable holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 24
console.log(Array.from([1, 2, 3], x => x + 1).join());
