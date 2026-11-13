// Collect stdio[N] and print on the child's 'close': the documented "all stdio streams have ended" point.
const { spawn } = require("child_process");
const which = process.argv[2] || "3";
const script = process.argv[3] || (which === "3" ? "printf hello >&3" : "printf hello");
const stdio = which === "3" ? ["ignore", "ignore", "ignore", "pipe"] : ["ignore", "pipe", "ignore"];
const c = spawn("sh", ["-c", script], { stdio });
const s = which === "3" ? c.stdio[3] : c.stdout;
let out = "", ended = false, closed = false;
s.on("data", d => (out += d));
s.on("end", () => (ended = true));
s.on("close", () => (closed = true));
c.on("close", code => { console.log(JSON.stringify({ which, bytes: out.length, ended, closed, code })); });
