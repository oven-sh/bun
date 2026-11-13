// Where does the fatal report land relative to the next call of the listener? No 'uncaughtException' handler.
// The first call blocks 200 ms so the socket is full when it returns: the read loop has a next chunk for sure.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const mode = process.argv[2]; // sync | tick | micro | then | async | async-await
const c = spawn(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(4 * 1024 * 1024, 97))"], { stdio: ["ignore", "pipe", "ignore"] });
let calls = 0;
const boom = () => { throw new Error("boom"); };
c.stdout.on("data", () => {
  calls++;
  if (calls <= 4) fs.writeSync(2, "data " + calls + "\n");
  if (calls > 1) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  if (mode === "sync") boom();
  if (mode === "tick") process.nextTick(boom);
  if (mode === "micro") queueMicrotask(boom);
  if (mode === "then") Promise.resolve().then(boom);
  if (mode === "async") (async () => { boom(); })();
  if (mode === "async-await") (async () => { await null; boom(); })();
});
c.stdout.on("end", () => fs.writeSync(2, "end\n"));
process.on("exit", code => fs.writeSync(2, "calls=" + calls + "\n"));
