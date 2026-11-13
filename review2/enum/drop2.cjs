// As drop1.cjs, but the read loop that meets the throw runs in a tick() of the main loop,
// so the loop polls once more after it: the child's 'close' follows the fatal throw.
// No 'uncaughtException' handler.
const { spawn } = require("node:child_process");
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
child.on("exit", code => console.log("child exit", code));
child.on("close", code => {
  console.log("child close", code);
  process.exit(code);
});
out.on("end", () => console.log("end"));
setTimeout(() => {
  // take what was read ahead, and ask for more: the read start is queued for the next tick()
  const head = out.read();
  console.log("head", head && head.length);
  out.read();
  out.once("readable", () => {
    out.on("data", chunk => {
      n++;
      console.log("data", n, chunk.length);
      busy(Number(process.env.BUSY || 50));
      if (n === 2) throw new Error("boom");
    });
  });
}, Number(process.env.DELAY || 300));
