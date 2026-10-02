process.on("uncaughtException", () => {});
process.on("exit", () => { throw new Error("exit listener throws"); });
require("node:trace_events").createTracing({ categories: ["node.perf"] }).enable();
