// A flowing 'data' listener from the start; the parent is busy in a timer while the child writes and exits.
const { spawn } = require("node:child_process");
const order = [];
const c = spawn(process.execPath, ["-e", `process.stdout.write(Buffer.alloc(3000, "o"));`], { stdio: ["ignore", "pipe", "pipe"] });
c.stdout.on("data", d => order.push("data"));
c.stdout.on("end", () => order.push("end"));
setTimeout(() => { const end = Date.now() + 400; while (Date.now() < end); }, 1);
c.on("exit", () => order.push("exit"));
c.on("close", () => console.log(order.join(", ")));
