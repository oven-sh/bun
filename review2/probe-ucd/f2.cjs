// Same child, same bytes, two routes: child.stdout (handle mode) and child.stdio[3] (net.Socket).
// No 'uncaughtException' handler. The child writes 4 MiB without gaps, so a read never drains the socket.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const [which, mode] = process.argv.slice(2); // stdout|fd3, sync|tick|micro
const fd = which === "stdout" ? 1 : 3;
const c = spawn("sh", ["-c", `head -c 4194304 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
const stream = which === "stdout" ? c.stdout : c.stdio[3];
const boom = () => { throw new Error("boom"); };
let n = 0;
stream.on("data", () => {
  n++;
  if (n === 1) {
    if (mode === "sync") boom();
    if (mode === "tick") process.nextTick(boom);
    if (mode === "micro") queueMicrotask(boom);
  }
});
process.on("exit", () => fs.writeSync(1, `${which} ${mode}: calls=${n === 1 ? "1" : ">1"}\n`));
