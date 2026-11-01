const { drainMicrotasks } = require("bun:jsc");
lines.push("drains begins");
drainMicrotasks();
lines.push("drains goes on");
