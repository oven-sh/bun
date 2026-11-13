// An 'uncaughtException' handler is installed. The child writes 1 KiB, then 100 ms later 150 KiB, and exits.
// The first 'data' call blocks 400 ms: when it returns (or throws), the second write, the EOF and the child's
// exit are all waiting.
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
process.on("uncaughtException", e => console.log("uncaught", e.message));
const c = spawn(process.execPath, ["-e", `process.stdout.write(Buffer.alloc(1024, 97)); setTimeout(() => process.stdout.write(Buffer.alloc(150 * 1024, 98)), 100)`], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0;
c.stdout.on("data", d => {
  n++; bytes += d.length;
  if (n === 1) {
    console.log("data 1");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    if (mode === "throw") throw new Error("boom");
  } else if (n === 2) console.log("data 2..");
});
c.stdout.on("end", () => console.log("end", bytes));
c.on("exit", code => console.log("exit", code));
c.on("close", code => console.log("close", code));
