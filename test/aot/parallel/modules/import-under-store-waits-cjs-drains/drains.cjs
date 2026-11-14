const { drainMicrotasks } = require("bun:jsc");
see("drains begins");
drainMicrotasks();
see("drains ends");
exports.text = "a" + process.argv.length;
