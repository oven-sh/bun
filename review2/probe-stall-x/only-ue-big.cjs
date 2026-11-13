// Only an 'uncaughtException' handler; the child writes 3 MB (more than the pipe holds); the listener throws on the 2nd chunk.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "sleep 0.1; head -c 3000000 /dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
const log = []; let n = 0, bytes = 0;
process.on("uncaughtException", (e, origin) => log.push("U(" + origin + ")"));
c.stdout.on("data", d => { bytes += d.length; if (++n === 2) throw new Error("boom"); });
c.stdout.on("end", () => log.push("end"));
c.on("close", code => log.push("close:" + code));
process.on("exit", code => console.log(`calls=${n} bytes=${bytes} ${log.join(" ")} | 'exit' code ${code}`));
