// An 'uncaughtException' handler is installed. The child writes more than one read's worth and exits.
// The first 'data' call blocks 300 ms: by the time it returns (or throws), the rest of the data, the EOF
// and the child's exit are all waiting.
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // throw | nothrow
const size = Number(process.argv[3] || 150) * 1024;
process.on("uncaughtException", e => console.log("uncaught", e.message));
const c = spawn(process.execPath, ["-e", `require('fs').writeSync(1, Buffer.alloc(${size}, 97))`], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0;
c.stdout.on("data", d => {
  n++; bytes += d.length;
  if (n === 1) {
    console.log("data 1");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    if (mode === "throw") throw new Error("boom");
  } else if (n === 2) console.log("data 2..");
});
c.stdout.on("end", () => console.log("end", bytes));
c.on("exit", code => console.log("exit", code));
c.on("close", code => console.log("close", code));
