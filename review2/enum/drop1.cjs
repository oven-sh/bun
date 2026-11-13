// A read start queued on this turn (by `_read()` in the checkpoint of a callback that returned false)
// is still in the task queue when a later callback of the same read loop throws.
// No 'uncaughtException' handler: the throw is fatal.
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
let n = 0;
function busy(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until);
}
child.stdout.once("readable", () => {
  child.stdout.on("data", chunk => {
    n++;
    console.log("data", n, chunk.length);
    // let the child refill the socket, so the read loop that is running has a next chunk
    busy(Number(process.env.BUSY || 50));
    if (n === 2) throw new Error("boom");
  });
});
child.stdout.on("end", () => console.log("end"));
child.on("exit", code => console.log("child exit", code));
child.on("close", code => {
  console.log("child close", code);
  process.exit(code);
});
// the child fills the socket before the first read start runs
spawnSync("sleep", [process.env.SLEEP || "0.3"]);
