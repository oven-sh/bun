const { spawn } = require("node:child_process");
const fd = +process.argv[2];
const c = spawn("sh", ["-c", `head -c 3000 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
let read;
c.on("exit", () => { const chunk = c.stdio[fd].read(); read = chunk === null ? null : chunk.length; });
c.on("close", code => console.log(JSON.stringify({ fd, read, code })));
