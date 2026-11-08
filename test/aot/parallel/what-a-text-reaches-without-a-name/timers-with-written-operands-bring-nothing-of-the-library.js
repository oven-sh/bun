// Each call binds the overload that runs no other code: an arrow function, a written delay that fits, an answer that is dropped. What the arrows print is written out or folded.
// STATISTIC: FunctionsLowered <= 8
// STATISTIC: SourceFilesRuntime = 0
const wait = 20;
queueMicrotask(() => console.log("microtask"));
setImmediate(() => console.log("immediate"));
setTimeout(() => console.log("timeout", wait + 1), wait);
setTimeout(() => setTimeout(() => console.log("inner", -1, `a`), 1), 80);
console.log("end");
