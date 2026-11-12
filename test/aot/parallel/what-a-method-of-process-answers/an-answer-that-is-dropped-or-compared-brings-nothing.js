// Where nobody holds the answer, `process` goes nowhere: nothing of Bun's library comes along.
// STATISTIC: FunctionsLowered <= 602
const heard = () => {};
process.off("madeUp", heard);
process.removeAllListeners("madeUp");
console.log(process.removeListener("madeUp", heard) === process);
