// Nothing of the program stands above `process` until node:events is loaded: packages that ask `process.type` or `process.pkg` where they run take nothing of Bun's library for it.
// STATISTIC: FunctionsLowered <= 600
// STATISTIC: ImageFunctionsEmitted <= 5
console.log(process.type, process.pkg, process.__nwjs, `${typeof process.madeUp}`);
