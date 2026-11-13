// pause() then resume(): the buffered chunk is emitted by flow() in a tick. No handler.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf a; sleep 0.2; printf b"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", d => { n++; console.log("data", String(d)); if (n === 1) { c.stdout.pause(); setTimeout(() => c.stdout.resume(), 500); } else throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("close", code => { console.log("child close", code); process.exit(code); });
