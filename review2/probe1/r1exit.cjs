// No 'uncaughtException' handler. Wrapper exits with the child's code from 'exit' (not 'close').
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf hi"], { stdio: ["ignore", "pipe", "ignore"] });
// Block the loop until the child has written and exited, so its data and its exit are in one poll batch.
c.on("spawn", () => { const end = Date.now() + 200; while (Date.now() < end); });
c.stdout.on("data", () => { console.log("data"); throw new Error("boom"); });
c.on("exit", code => { console.log("child exit", code); process.exit(code); });
