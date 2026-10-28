const { drainMicrotasks } = require("bun:jsc");
lines.push("drains begins");
track("second", import("./second.mjs"));
drainMicrotasks();
lines.push("drains goes on");
