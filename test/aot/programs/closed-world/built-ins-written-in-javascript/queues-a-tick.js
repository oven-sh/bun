// process.nextTick is a function of Bun's library, and it is entered with the callback of this call: no callee in the executable is unknown, and it holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 48
// STATISTIC: FlowCallsOfUnknownCallees = 0
process.nextTick(() => console.log(1));
