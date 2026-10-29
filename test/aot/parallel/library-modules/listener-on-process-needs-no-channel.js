// A listener for an event of `process` that is no message from a parent process needs nothing of the channel to one. The functions of the channel hang node:net and node:dgram behind them.
// STATISTIC: FunctionsLowered <= 600
process.on("exit", code => console.log("exit", code));
process.once("beforeExit", () => console.log("before exit"));
process.prependListener("exit", () => console.log("first"));
process.addListener("warning", () => {});
console.log("ran", process.listenerCount("exit"));
