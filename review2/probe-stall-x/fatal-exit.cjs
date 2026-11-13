// No 'uncaughtException' handler. A listener attached in the child's 'exit' throws on every chunk read ahead of it.
// argv: <chunks> ; the wrapper exits with the child's code from 'close'.
const { spawn } = require("node:child_process");
const k = +(process.argv[2] || 1);
const script = Array.from({ length: k }, (_, i) => `printf ${i + 1}`).join("; sleep 0.05; ");
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.on("exit", () => {
  console.log("exit");
  c.stdout.on("data", d => { n++; console.log("data " + d); throw new Error("boom"); });
  c.stdout.on("end", () => console.log("end"));
});
c.on("close", code => { console.log("child close", code); process.exit(code); });
