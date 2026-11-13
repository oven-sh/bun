// chunk + EOF both read before the listener attaches (child hangs up its stdout but stays alive)
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "co", "s:300", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
const log = s => require("fs").writeSync(1, s + "\n");
c.on("exit", () => log("child exit")); c.on("close", () => log("child close"));
c.stdout.on("end", () => log("end")); c.stdout.on("close", () => log("close"));
setTimeout(() => {
  log("attach");
  c.stdout.on("data", async d => { log("data " + d); process.nextTick(() => log("tick")); await null; log("continuation"); });
}, 100);
