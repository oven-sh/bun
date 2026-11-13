// As a3.cjs, but the listener does ~3 ms of synchronous work on the first chunk before it throws (or returns).
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const size = Number(process.argv[3] || 400000);
process.on("uncaughtException", () => {});
const c = spawn("head", ["-c", String(size), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0, atExit = -1;
c.stdout.on("data", d => {
  n++; bytes += d.length;
  if (n === 1) {
    const until = performance.now() + 3;
    while (performance.now() < until);
    if (mode === "throw") throw new Error("boom");
  }
});
c.on("exit", () => { atExit = bytes; });
c.on("close", () => console.log(atExit === size ? "all data before exit" : "exit with N bytes undelivered"));
