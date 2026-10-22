// One function of Bun's library runs for every call of Array.prototype.map, so the compiler does not follow the callback that it calls. That is no sign of code that nobody compiles: the executable holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 16
// STATISTIC: FlowCallsOfUnknownCallees <= 15
console.log([1, 2, 3].map(x => x + 1).length);
