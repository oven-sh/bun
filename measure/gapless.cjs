// A writer that never pauses: head -c SIZE /dev/zero. env: SIZE, FD (1|2).
const { spawn } = require("node:child_process");
const SIZE = +process.env.SIZE || 256 * 1024 * 1024;
const name = process.env.FD === "2" ? "stderr" : "stdout";
const child = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero ${name === "stderr" ? ">&2" : ""}`], { stdio: ["ignore", "pipe", "pipe"] });
let n = 0, bytes = 0;
child[name].on("data", chunk => { n++; bytes += chunk.length; });
child.on("close", () => console.log(JSON.stringify({ n, bytes })));
