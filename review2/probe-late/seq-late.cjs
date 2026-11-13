// A short child (seq 1 N: stdio-buffered, written in 4 KiB blocks back to back) that stays alive; a 'data' listener attached 250 ms later. Reports the number of 'data' events and whether the first one held the whole output.
const { spawn } = require("child_process");
const N = process.argv[2] || "5000";
const c = spawn("sh", ["-c", `seq 1 ${N}; sleep 0.5`], { stdio: ["ignore", "pipe", "ignore"] });
const sizes = [];
setTimeout(() => {
  c.stdout.on("data", d => sizes.push(d.length));
  setTimeout(() => { const total = sizes.reduce((a, b) => a + b, 0); console.log(`events=${sizes.length} first=${sizes[0]} total=${total} firstIsWhole=${sizes[0] === total}`); process.exit(0); }, 120);
}, 250);
