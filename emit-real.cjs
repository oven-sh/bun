// ns per emit("data", chunk) on a real child.stdout with one listener. Run it with each build.
const { spawn } = require("node:child_process");
const c = spawn("sleep", ["30"], { stdio: ["ignore", "pipe", "ignore"] });
const s = c.stdout;
let n = 0;
s.on("data", chunk => { n += chunk.length; });
s.pause();
const chunk = Buffer.alloc(16);
const N = 5e6;
const rounds = [];
for (let r = 0; r < 7; r++) {
  for (let i = 0; i < 2e5; i++) s.emit("data", chunk);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) s.emit("data", chunk);
  rounds.push(Number(process.hrtime.bigint() - t0) / N);
}
console.log((Object.hasOwn(s, "emit") ? "own emit      " : "inherited emit") + " ns/emit: " + rounds.map(v => v.toFixed(1)).join(" ") + " | min " + Math.min(...rounds).toFixed(1));
c.kill();
