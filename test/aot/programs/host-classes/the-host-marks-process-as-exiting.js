// The host stores `process._exiting = true` itself when the program ends. No statement of the program stores to it.
console.log(process._exiting);
process.on("beforeExit", () => console.log("beforeExit", process._exiting, process.exitCode));
process.on("exit", code => console.log("exit", process._exiting, Object.getOwnPropertyDescriptor(process, "_exiting").value, code, process.exitCode));
