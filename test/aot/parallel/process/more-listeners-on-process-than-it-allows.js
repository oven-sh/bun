// An event of `process` with more listeners than `_maxListeners` allows prints a warning. Native code counts the listeners, and a program that only adds some has the function of the library that makes the warning, and not the printer of node:util.
// STATISTIC: ImageFunctionsEmitted <= 100
for (let i = 0; i < 11; i++) process.on("custom", () => {});
process.setMaxListeners(1).once("second", () => {});
process.prependListener("second", () => {});
console.log(process.listenerCount("custom"), process.listenerCount("second"), process._maxListeners === 1);
