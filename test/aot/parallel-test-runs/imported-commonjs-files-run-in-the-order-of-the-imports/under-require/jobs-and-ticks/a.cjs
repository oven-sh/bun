console.log("a");
exports.x = 1;
queueMicrotask(() => console.log("job of a"));
process.nextTick(() => console.log("tick of a"));
