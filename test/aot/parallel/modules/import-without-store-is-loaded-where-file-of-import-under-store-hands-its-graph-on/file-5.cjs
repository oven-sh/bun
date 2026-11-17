const { drainMicrotasks } = require("bun:jsc");
see("drain under X: file");
store.run("X", () => drainMicrotasks());
see("drain under X: file behind the trigger");
exports.name = "file-5";
