// A listener queues a tick and a promise job per chunk. Node: d1 t1 j1 d2 t2 j2 ...
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf a; sleep 0.2; printf b; sleep 0.2; printf c"], { stdio: ["ignore", "pipe", "ignore"] });
const seen = []; let n = 0;
c.stdout.on("data", () => { const k = ++n; seen.push("d" + k); process.nextTick(() => seen.push("t" + k)); Promise.resolve().then(() => seen.push("j" + k)); });
c.stdout.on("end", () => setImmediate(() => console.log(seen.join(" "))));
