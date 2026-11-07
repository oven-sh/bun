const { drainMicrotasks } = require("bun:jsc");
lines.push("drains begins");
Promise.resolve().then(() => lines.push("the job of drains"));
drainMicrotasks();
lines.push("drains goes on");
