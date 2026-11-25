// Nothing here is written in Bun's library: an error, a date, numbers, a weak map, a symbol are made and asked by native code alone.
// STATISTIC: FunctionsLowered <= 30
// STATISTIC: SourceFilesRuntime <= 12
const failed = new RangeError("too far", { cause: new Error("first") });
console.log(failed.message, failed.cause.message, new Date(0).getTime(), (255).toString(16), 2n ** 64n, Math.hypot(3, 4), new WeakMap().has({}), Symbol("made").description);
