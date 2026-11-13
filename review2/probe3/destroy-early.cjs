// The parent destroys child.stdout; what does the child's next write to stdout get?
const { spawn } = require("child_process");
const when = process.argv[2];  // sync | afterdata
const delay = when === "sync" ? 0.2 : 0;
// the child: optional first write, sleep, then a write whose error it reports on stderr
const script = `trap 'echo SIGPIPE >&2; exit 0' PIPE; ${when === "afterdata" ? "printf first;" : ""} sleep 0.3; printf second 2>/dev/null || echo "write-failed" >&2; echo done >&2`;
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
let err = ""; c.stderr.on("data", d => (err += d));
if (when === "sync") c.stdout.destroy();
else setTimeout(() => c.stdout.destroy(), 150);   // 'first' is in the pipe, nothing has read it (no listener)
c.on("close", (code, sig) => console.log(when, JSON.stringify(err.trim().split("\n")), code, sig));
