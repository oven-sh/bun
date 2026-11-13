// 'uncaughtException' handler installed. 300000 bytes from head; the listener queues an immediate on the first
// chunk, then throws (or returns). Where does the immediate run relative to the data that is already in the socket?
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const ev = [];
process.on("uncaughtException", () => ev.push("uncaught"));
const c = spawn("head", ["-c", "300000", "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", () => {
  n++; if (ev[ev.length - 1] !== "data") ev.push("data");
  if (n === 1) {
    setImmediate(() => ev.push("immediate"));
    const until = performance.now() + 3;
    while (performance.now() < until);
    if (mode === "throw") throw new Error("boom");
  }
});
c.stdout.on("end", () => ev.push("end"));
c.on("exit", () => ev.push("exit"));
c.on("close", () => console.log(ev.join("; ")));
