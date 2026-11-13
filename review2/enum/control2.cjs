// drop1.cjs with the listener attached at spawn: no `_read()` in the checkpoint of a call that returned false,
// so no read start is queued on the turn of the throw.
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
child.stdout.on("data", chunk => {
  n++;
  console.log("data", n, chunk.length);
  busy(Number(process.env.BUSY || 50));
  if (n === 2) throw new Error("boom");
});
child.stdout.on("end", () => console.log("end"));
child.on("exit", code => console.log("child exit", code));
child.on("close", code => {
  console.log("child close", code);
  process.exit(code);
});
spawnSync("sleep", [process.env.SLEEP || "0.3"]);
