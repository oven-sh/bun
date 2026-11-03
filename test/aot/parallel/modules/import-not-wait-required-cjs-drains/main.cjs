// A file that require() runs calls import() and then drainMicrotasks() of bun:jsc: no load is evaluating the file, so a module that imports it is linked at once with what the file exports by then.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
console.log("main", require("./file.cjs").text);
