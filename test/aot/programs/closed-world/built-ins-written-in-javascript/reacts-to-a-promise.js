// A reaction to a promise is called with what the promise was resolved with: no callee and no receiver in the executable is unknown.
// STATISTIC: ImageFunctionsEmitted <= 96
// STATISTIC: FlowCallsOfUnknownCallees = 0
// STATISTIC: FlowAccessesOfUnknownReceivers = 0
Promise.resolve(1).then(v => console.log(v));
