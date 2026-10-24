process.on("beforeExit", () => console.log("before exit"));
process.once("exit", code => console.log("exit " + code));
console.log("started", process.listenerCount("exit"));
