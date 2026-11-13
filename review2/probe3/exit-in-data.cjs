const { spawn } = require("child_process");
const mode = process.argv[2] || "exit";
const c = spawn("sh", ["-c", "while :; do echo ready; done"], { stdio: ["ignore", "pipe", "pipe"] });
let n = 0;
process.on("exit", code => { console.log("exit handler", code, "n", n); });
c.stdout.on("data", d => {
  n++;
  if (n === 2) {
    if (mode === "exit") process.exit(7);
    if (mode === "kill-exit") { c.kill(); process.exit(8); }
    if (mode === "destroy-exit") { c.stdout.destroy(); process.exit(9); }
    if (mode === "abort-gc") { Bun.gc(true); process.exit(10); }
  }
});
