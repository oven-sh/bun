// No 'uncaughtException' handler. The child writes once and exits at once; the parent is busy for 60 ms, so the
// chunk, the hang-up and the exit are all there when the loop turns. A wrapper forwards the child's exit code.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => { console.log("child exit", code); process.exit(code); });
c.on("close", code => console.log("child close", code));
if (process.argv[2] === "nap") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
