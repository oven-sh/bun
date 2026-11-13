// No artificial delay. `head -c N /dev/zero` exits as soon as its last write fits the socket.
// An 'uncaughtException' handler is installed; the listener throws on the first chunk only (or never).
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const size = Number(process.argv[3] || 400000);
process.on("uncaughtException", () => {});
const c = spawn("head", ["-c", String(size), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0, atExit = -1;
c.stdout.on("data", d => { n++; bytes += d.length; if (n === 1 && mode === "throw") throw new Error("boom"); });
c.on("exit", () => { atExit = bytes; });
c.on("close", () => console.log(atExit === size ? "all data before exit" : "exit with " + (size - atExit) + " bytes undelivered"));
