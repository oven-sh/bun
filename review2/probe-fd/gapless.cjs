// As /tmp/m/gapless.cjs, with FD=1|3.
const { spawn } = require("node:child_process");
const SIZE = +process.env.SIZE || 256 * 1024 * 1024;
const fd = +process.env.FD || 1;
const child = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero >&${fd}`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
let n = 0, bytes = 0;
const s = child.stdio[fd];
s.on("data", chunk => { n++; bytes += chunk.length; });
s.on("close", () => console.log(JSON.stringify({ n, bytes })));
