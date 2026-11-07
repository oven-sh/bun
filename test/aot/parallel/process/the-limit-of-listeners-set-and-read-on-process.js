// setMaxListeners and getMaxListeners of `process` store and read its `_maxListeners`. They bring node:events into no executable.
// STATISTIC: ImageFunctionsEmitted <= 30
process.setMaxListeners(20).on("exit", () => {});
console.log(process.getMaxListeners(), process._maxListeners);
