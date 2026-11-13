// 'data' listener attached at spawn; the stream is paused for a while (chunks pile up in the Readable), then resumed. The listener throws on every chunk.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "for i in 1 2 3 4 5; do printf $i; sleep 0.05; done; sleep 0.4; printf 6"], { stdio: ["ignore", "pipe", "ignore"] });
const log = []; 
process.on("uncaughtException", e => log.push("U"));
process.on("unhandledRejection", e => log.push("unhandledRejection"));
c.stdout.on("data", d => { log.push("data:" + d); throw new Error("boom"); });
c.stdout.on("end", () => log.push("end"));
c.stdout.pause();
setTimeout(() => { log.push("resume"); c.stdout.resume(); }, 350);
c.on("exit", () => log.push("exit"));
c.on("close", code => log.push("close:" + code));
setTimeout(() => { console.log(log.join(" ")); process.exit(0); }, 2000);
