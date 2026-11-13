// No 'uncaughtException' handler. The listener returns normally; the fatal error comes from what it queued.
const { spawn } = require("node:child_process");
const mode = process.argv[2]; // sync | tick | micro | then | async | async-await
const wrap = process.argv[3] === "wrap";
const c = spawn(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(4 * 1024 * 1024, 97))"], { stdio: ["ignore", "pipe", "ignore"] });
let calls = 0;
const seen = [];
const boom = () => { throw new Error("boom"); };
c.stdout.on("data", () => {
  calls++;
  if (calls > 1) return;
  if (mode === "sync") boom();
  if (mode === "tick") process.nextTick(boom);
  if (mode === "micro") queueMicrotask(boom);
  if (mode === "then") Promise.resolve().then(boom);
  if (mode === "async") (async () => { boom(); })();
  if (mode === "async-await") (async () => { await null; boom(); })();
});
c.stdout.on("end", () => seen.push("end"));
c.stdout.on("close", () => seen.push("close"));
c.on("close", code => { seen.push("child close " + code); if (wrap) process.exit(code); });
process.on("exit", code => console.log(JSON.stringify({ mode, code, calls, seen })));
