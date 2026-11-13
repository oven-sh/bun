// What a read() sees if the child's 'exit' were delivered after the rest of the poll batch.
// how = "now" (as today), "tick" (process.nextTick), "immediate" (setImmediate), "micro" (promise job)
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3, how = process.argv[3] || "now";
const N = +process.env.N || 1;
let i = 0; const out = {};
function run() {
  if (i++ === N) { console.log(`fd${fd} ${how}: ` + JSON.stringify(out)); return; }
  const c = spawn("sh", ["-c", `head -c 3000 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
  const s = c.stdio[fd];
  const look = () => { const chunk = s.read(); const k = String(chunk === null ? null : chunk.length); out[k] = (out[k] || 0) + 1; setTimeout(run, 30); };
  c.on("exit", () => {
    if (how === "now") look();
    else if (how === "tick") process.nextTick(look);
    else if (how === "micro") Promise.resolve().then(look);
    else setImmediate(look);
  });
}
run();
