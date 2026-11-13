// No 'uncaughtException' handler. A server-like process (kept alive by a timer) whose child 'data' listener throws once.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "sleep 0.1; printf a; sleep 0.1; printf b"], { stdio: ["ignore", "pipe", "ignore"] });
c.stdout.on("data", d => { console.log("data", String(d)); throw new Error("boom"); });
c.on("close", code => console.log("close", code));
setTimeout(() => { console.log("still alive after 1 s"); }, 1000);
