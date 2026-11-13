// A 'data' listener throws (handled by 'uncaughtException'). While it ran, the child wrote its last chunk and exited.
const { spawn } = require("node:child_process");
const BUSY = Number(process.argv[2] ?? 400);
const order = [];
process.on("uncaughtException", e => order.push("uncaught"));
const writer = `const fs = require("fs"); fs.writeSync(1, "1"); const nap = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(nap, 0, 0, 100); fs.writeSync(1, "2");`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["ignore", "pipe", "inherit"] });
child.stdout.on("data", d => {
  order.push("data " + d);
  if (String(d) === "1") {
    const end = Date.now() + BUSY; while (Date.now() < end);
    throw new Error("boom");
  }
});
child.stdout.on("end", () => order.push("end"));
child.on("exit", () => order.push("exit"));
child.on("close", () => console.log(order.join(", ")));
