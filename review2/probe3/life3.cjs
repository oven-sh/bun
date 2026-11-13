// An unref'd child that keeps writing. Does the parent's lifetime match main?
const { spawn } = require("child_process");
const mode = process.argv[2];
const t0 = Date.now();
const c = spawn("sh", ["-c", "head -c 2000000 /dev/zero; sleep 2"]);
c.unref();
if (mode === "touch") { void c.stdout; void c.stderr; }
if (mode === "end-listener") c.stdout.on("end", () => {});
if (mode === "readable-once") c.stdout.once("readable", () => {});
if (mode === "read0") c.stdout.read(0);
if (mode === "pause") c.stdout.pause();
if (mode === "data-then-off") { const f = () => {}; c.stdout.on("data", f); c.stdout.off("data", f); }
if (mode === "data-pause") { c.stdout.on("data", () => {}); c.stdout.pause(); }
if (mode === "iterator-unused") { c.stdout[Symbol.asyncIterator](); }
process.on("exit", () => console.log(mode.padEnd(16), "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
