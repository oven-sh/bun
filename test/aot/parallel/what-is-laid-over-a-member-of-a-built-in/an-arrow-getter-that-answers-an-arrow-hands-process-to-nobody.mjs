// Neither the arrow nor the arrow that it answers has a `this` of its own: `process` is handed to nobody.
// STATISTIC: FunctionsLowered <= 700
Object.defineProperty(process, "cwd", { get: () => () => "made up", configurable: true });
console.log("SAID", process.cwd());
