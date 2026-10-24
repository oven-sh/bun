// The function of Bun's library behind Array.prototype.map, and the helper that takes the place of a chain of such calls, get the one array and the one callback of this program: no callee and no receiver in the executable is unknown.
// STATISTIC: FlowCallsOfUnknownCallees = 0
// STATISTIC: FlowAccessesOfUnknownReceivers = 0
console.log([1, 2, 3].map(x => x + 1).length);
