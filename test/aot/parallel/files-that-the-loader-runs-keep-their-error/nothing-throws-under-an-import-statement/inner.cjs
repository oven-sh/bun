let reads = 0;
globalThis.again = () => require("./inner.cjs");
exports.value = 7;
exports.show = () => ++reads;
