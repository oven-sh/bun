const { Worker } = require("worker_threads");
const w = new Worker(
  `process.on("exit", c => { console.log("exit 1", c); throw new Error("exit-throws"); });
   process.on("exit", c => console.log("exit 2", c));
   process.exit(3);`,
  { eval: true },
);
w.on("error", e => console.log("worker error:", e.message));
w.on("exit", c => console.log("worker exit", c));
