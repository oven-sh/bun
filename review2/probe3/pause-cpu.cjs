// child writes 1 MB then idles 2 s; the parent pauses the stream after the first chunk.
const { spawn } = require("child_process");
const mode = process.argv[2] || "pause";
const c = spawn("sh", ["-c", "head -c 1000000 /dev/zero; sleep 2"]);
let bytes = 0, chunks = 0;
const t0 = Date.now();
if (mode === "unref") c.unref();
c.stdout.on("data", d => {
  bytes += d.length; chunks++;
  if (chunks === 1) c.stdout.pause();
});
c.on("exit", () => console.log("exit at", Date.now() - t0, "ms bytes", bytes));
c.on("close", () => console.log("close at", Date.now() - t0, "ms bytes", bytes));
process.on("exit", () => {
  const u = process.cpuUsage();
  console.log("parent exit at", Date.now() - t0, "ms; cpu user", (u.user / 1000) | 0, "ms sys", (u.system / 1000) | 0, "ms; bytes", bytes, "chunks", chunks, "readableLength", c.stdout.readableLength);
});
