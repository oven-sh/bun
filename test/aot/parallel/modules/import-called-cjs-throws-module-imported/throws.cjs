const { drainMicrotasks } = require("bun:jsc");
lines.push("throws begins");
track("waits", import("./waits.mjs"));
drainMicrotasks();
lines.push("throws goes on");
throw new Error("thrown");
