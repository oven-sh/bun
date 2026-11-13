const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const size = Number(process.argv[3] || 400000);
const busy = Number(process.argv[4] || 3);
process.on("uncaughtException", () => ev.push("uncaught"));
const ev = [];
const c = spawn("head", ["-c", String(size), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0;
c.stdout.on("data", d => {
  n++; bytes += d.length; ev.push("data " + d.length);
  if (n === 1) {
    const until = performance.now() + busy;
    while (performance.now() < until);
    if (mode === "throw") throw new Error("boom");
  }
});
c.stdout.on("end", () => ev.push("end"));
c.on("exit", () => ev.push("exit"));
c.on("close", () => console.log(ev.join("; ")));
