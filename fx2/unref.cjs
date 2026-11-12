// An unref'd child whose pipes nobody reads: how long does the parent stay?
const { spawn } = require("node:child_process");
const t0 = Date.now();
const c = spawn("sleep", ["2"]);
c.unref();
process.on("exit", () => console.log("parent exit after " + (Math.round((Date.now() - t0) / 100) / 10) + " s, stdout own prop at spawn: " + Object.hasOwn(c, "stdout")));
