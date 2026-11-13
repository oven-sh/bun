// child writes 1 MB (blocks on backpressure) ; the parent pauses the stream after the first chunk and idles 2 s.
const { spawn } = require("child_process");
const mode = process.argv[2] || "pause";
const script = mode === "hup" ? "head -c 300000 /dev/zero" : "head -c 1000000 /dev/zero; sleep 5";
const c = spawn("sh", ["-c", script]);
let bytes = 0, chunks = 0;
const t0 = Date.now();
c.stdout.on("data", d => {
  bytes += d.length; chunks++;
  if (chunks === 1) c.stdout.pause();
});
c.on("exit", () => console.log("exit at", Date.now() - t0, "ms bytes", bytes));
setTimeout(() => {
  const u = process.cpuUsage();
  console.log(mode, "after 2s: cpu user", (u.user / 1000) | 0, "ms sys", (u.system / 1000) | 0, "ms; bytes", bytes, "chunks", chunks, "readableLength", c.stdout.readableLength);
  c.kill("SIGKILL");
  process.exit(0);
}, 2000);
