// A second way into the same state: the listener looks at the first chunk, puts it back with unshift(),
// and resumes from a promise job. push() returns false for that call, and `_read()` runs in its checkpoint.
// No 'uncaughtException' handler.
const { spawn, spawnSync } = require("node:child_process");
const child = spawn(
  process.execPath,
  [
    "-e",
    `const b = Buffer.alloc(65536, 120);
     let i = 0;
     (function w() { while (i < 24) { i++; if (!process.stdout.write(b)) return process.stdout.once('drain', w); } })();`,
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const out = child.stdout;
let n = 0;
function busy(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until);
}
out.on("data", chunk => {
  n++;
  console.log("data", n, chunk.length);
  if (n === 1) {
    out.pause();
    out.unshift(chunk);
    queueMicrotask(() => out.resume());
    return;
  }
  busy(Number(process.env.BUSY || 50));
  if (n === 3) throw new Error("boom");
});
out.on("end", () => console.log("end"));
child.on("exit", code => console.log("child exit", code));
child.on("close", code => {
  console.log("child close", code);
  process.exit(code);
});
spawnSync("sleep", [process.env.SLEEP || "0.3"]);
