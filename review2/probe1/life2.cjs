const { spawn } = require("node:child_process");
const mode = process.argv[2];
const n = +process.argv[3] || 3;
const stdio = n === 3 ? ["ignore", "pipe", "pipe"] : n === 2 ? ["ignore", "pipe"] : ["ignore"];
const t0 = Date.now();
const c = spawn("sh", ["-c", "printf hi; sleep 2"], { stdio });
if (mode === "unref-then-data") { c.unref(); c.stdout.on("data", () => {}); }
if (mode === "data-then-unref") { c.stdout.on("data", () => {}); c.unref(); }
if (mode === "unref-only") { c.unref(); }
if (mode === "unref-then-touch") { c.unref(); void c.stdout; }
if (mode === "unref-then-readable") { c.unref(); c.stdout.on("readable", () => {}); }
if (mode === "unref-then-pipe") { c.unref(); c.stdout.pipe(process.stdout); }
if (mode === "unref-late-data") { c.unref(); setTimeout(() => c.stdout.on("data", () => {}), 100); }
process.on("exit", () => console.log(mode, "stdio" + n, "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
