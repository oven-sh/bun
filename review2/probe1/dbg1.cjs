// (a) process.exit() inside a 'data' listener on the last chunk (data + EOF in one wakeup).
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf hi"], { stdio: ["ignore", "pipe", "ignore"] });
c.on("spawn", () => { const end = Date.now() + 300; while (Date.now() < end); });
c.stdout.on("data", d => { console.log("data", String(d)); process.exit(7); });
