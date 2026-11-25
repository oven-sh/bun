// A definition under a written name whose getter is an arrow function hands `process` to nobody.
// STATISTIC: FunctionsLowered <= 600
Object.defineProperty(process, "answerOfThisProgram", { get: () => 42, configurable: true });
console.log(process.answerOfThisProgram);
