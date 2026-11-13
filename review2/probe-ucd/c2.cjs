// No 'uncaughtException' handler. The data and the EOF of stdout arrive after the child's 'exit' (as /tmp/frame/r1c.cjs),
// so only 'end' and the child's 'close' are still due when the listener runs. A close wrapper exits with the child's code.
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // sync | tick | micro | then | async | async-await
const c = spawn("sh", ["-c", "(read line <&3; printf hi) & exit 0"], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
let n = 0;
const boom = () => { console.log("boom"); throw new Error("boom"); };
c.stdio[3].on("error", () => {});
c.stdout.on("data", () => {
  n++; console.log("data", n);
  // The EOF is in the socket when the listener returns.

  if (mode === "sync") boom();
  if (mode === "tick") process.nextTick(boom);
  if (mode === "micro") queueMicrotask(boom);
  if (mode === "then") Promise.resolve().then(boom);
  if (mode === "async") (async () => { boom(); })();
  if (mode === "async-await") (async () => { await null; boom(); })();
});
c.stdout.on("end", () => console.log("end"));
c.on("exit", () => { console.log("exit"); c.stdio[3].end("\n"); });
c.on("close", code => { console.log("child close", code); process.exit(code); });
