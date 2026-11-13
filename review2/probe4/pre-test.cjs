const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf out; printf err >&2"], { stdio: ["ignore", "pipe", "pipe"] });
let o = "", e = "";
c.stdout.on("data", d => (o += d)); c.stderr.on("data", d => (e += d));
c.on("close", code => console.log(JSON.stringify({ ctor: c.stdout.constructor.name, o, e, code, stdioLen: c.stdio.length, isCP: c instanceof require("node:child_process").ChildProcess })));
