// How long does the parent stay for an unref'd child? MODE: plain | touch | data | readable | pause
const { spawn } = require("node:child_process");
const t0 = Date.now();
const c = spawn("sleep", ["2"]);
c.unref();
const mode = process.env.MODE || "plain";
if (mode === "touch") c.stdout;
if (mode === "data") c.stdout.on("data", () => {});
if (mode === "readable") c.stdout.on("readable", () => {});
if (mode === "pause") { c.stdout.on("data", () => {}); c.stdout.pause(); }
if (mode === "unrefall") { c.stdout.unref(); c.stderr.unref(); c.stdin.unref?.(); }
process.on("exit", () => console.log(mode.padEnd(9) + (Math.round((Date.now() - t0) / 100) / 10) + " s"));
