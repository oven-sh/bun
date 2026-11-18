const { drainMicrotasks } = require("bun:jsc");
see("drain: file");
drainMicrotasks();
see("drain: file behind the trigger");
exports.name = "file-2";
