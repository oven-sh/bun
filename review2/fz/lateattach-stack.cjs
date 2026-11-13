const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:30", "oB:3", "s:30", "oC:3", "s:400", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
setTimeout(() => {
  c.stdout.on("data", d => { n++; console.log("call", n, String(d), "\n" + new Error("where").stack.split("\n").slice(1, 12).join("\n")); throw new Error("boom " + n); });
}, 150);
