// An async 'data' listener that is attached after spawn: in the child's 'exit' (argv[2] = exit), on setImmediate
// (imm), or after a 20 ms timer (timer). The child writes once and exits at once.
const { spawn } = require("node:child_process");
const how = process.argv[2];
const c = spawn("sh", ["-c", "printf hi"], { stdio: ["ignore", "pipe", "ignore"] });
const log = s => require("fs").writeSync(1, s + "\n");
const attach = () => {
  c.stdout.on("data", async d => { log("data"); process.nextTick(() => log("listener tick")); await null; log("listener continuation"); });
};
c.stdout.on("end", () => log("end"));
c.stdout.on("close", () => log("stdout close"));
c.on("exit", () => { log("child exit"); if (how === "exit") attach(); });
c.on("close", () => log("child close"));
if (how === "imm") setImmediate(attach);
if (how === "sync") attach();
