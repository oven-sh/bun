// Only an 'uncaughtException' handler (the common server/test-runner setup). Listener attached at spawn, throws on every chunk.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "for i in 1 2 3; do sleep 0.1; printf $i; done"], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
process.on("uncaughtException", (e, origin) => log.push("U(" + origin + ")"));
c.stdout.on("data", d => { log.push("data:" + d); throw new Error("boom"); });
c.stdout.on("end", () => log.push("end"));
c.on("close", code => log.push("close:" + code));
process.on("exit", code => console.log(log.join(" ") + " | process exit code " + code));
