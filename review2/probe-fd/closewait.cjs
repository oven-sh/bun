// Does the child's 'close' wait for the stream at fd N, and is an unread stream flushed when the child exits?
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const c = spawn("sh", ["-c", `sleep 0.05; head -c 3000 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
const s = c.stdio[fd];
const seen = [];
s.on("end", () => seen.push("stream end"));
s.on("close", () => seen.push("stream close"));
c.on("exit", () => seen.push("exit"));
c.on("close", () => seen.push("child close"));
setTimeout(() => console.log(`fd${fd}: ${seen.join(", ")} | after 300 ms: readableLength=${s.readableLength} destroyed=${s.destroyed}`), 300);
