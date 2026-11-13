const { spawn } = require("node:child_process");
const mode = process.argv[2];
const t0 = Date.now();
const c = spawn("sleep", ["2"]);
c.unref();
if (mode === "touch") { void c.stdout; void c.stderr; }
if (mode === "data") c.stdout.on("data", () => {});
if (mode === "unrefpipes") { c.stdout.unref?.(); c.stderr.unref?.(); c.stdin.unref?.(); c.stdout.on("data", () => {}); }
process.on("exit", () => console.log(mode, "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
