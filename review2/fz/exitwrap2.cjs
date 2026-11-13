// No 'uncaughtException' handler. The listener throws on the child's last chunk; the child exits right after writing it.
// A wrapper forwards the child's exit code from 'exit'.
// argv[2]: size of the last chunk. argv[3]: "sh" for a shell child that prints and exits.
const { spawn } = require("node:child_process");
const size = process.argv[2] || "40000";
const c = process.argv[3] === "sh"
  ? spawn("sh", ["-c", `sleep 0.05; head -c ${size} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] })
  : spawn("/tmp/fz/w", ["s:40", `oC:${size}`, "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", d => { console.log("data", ++n, d.length); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => { console.log("child exit", code); process.exit(code); });
c.on("close", code => console.log("child close", code));
