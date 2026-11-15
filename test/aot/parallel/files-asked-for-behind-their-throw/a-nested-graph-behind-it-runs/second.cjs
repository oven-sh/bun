process.nextTick(() => console.log("tick of second"));
console.log("second runs");
exports.value = globalThis.seen = "second";
