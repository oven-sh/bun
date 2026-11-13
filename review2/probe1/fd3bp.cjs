// Does an fd-backed net.Socket (stdio[3]) keep kernel backpressure? The child writes 8 MiB to fd 3 (or fd 1) and reports on stderr when done.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const mode = process.argv[3] || "untouched";
const child = spawn("sh", ["-c", `head -c 8388608 /dev/zero >&${fd}; echo written >&2`], { stdio: ["ignore", "pipe", "pipe", "pipe"] });
const s = child.stdio[fd];
let err = "", got = 0;
child.stderr.on("data", d => (err += d));
if (mode === "pause-after-first") s.on("data", d => { got += d.length; s.pause(); });
if (mode === "readable-no-read") s.on("readable", () => {});
setTimeout(() => {
  console.log(`fd${fd} ${mode}: child ${err.includes("written") ? "finished writing (NOT blocked)" : "blocked"}; got=${got} readableLength=${s.readableLength} ctor=${s.constructor.name}`);
  child.kill();
  process.exit(0);
}, 1500);
