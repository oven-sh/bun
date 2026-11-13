// N sequential spawns of `true`; EXTRA=k adds k extra "pipe" entries at fd >= 3 (each wrapped in net.Socket on main)
const { spawn } = require("node:child_process");
const N = +process.env.N || 50, extra = +process.env.EXTRA || 0;
const stdio = ["ignore", "pipe", "pipe"]; for (let k = 0; k < extra; k++) stdio.push("pipe");
let i = 0;
(function next() {
  if (i++ === N) return;
  const c = spawn("true", [], { stdio });
  c.on("close", next);
})();
