// A program that awaits a promise has the function that prints a warning and the tick queue, and native code calls them with what the table lists: no callee and no receiver in the executable is unknown.
// STATISTIC: ImageFunctionsEmitted <= 96
// STATISTIC: FlowCallsOfUnknownCallees = 0
// STATISTIC: FlowAccessesOfUnknownReceivers = 0
const v = await Promise.resolve(1);
console.log(v);
