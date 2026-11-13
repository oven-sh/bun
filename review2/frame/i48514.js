const { spawn } = require("node:child_process");
function readExactly(stream, size) {
  return new Promise((resolve) => {
    let missing = size;
    stream.on("readable", function onReadable() {
      if (stream.readableLength === 0) return;
      missing -= stream.read(Math.min(missing, stream.readableLength)).length;
      if (missing === 0) { stream.off("readable", onReadable); resolve(); }
    });
  });
}
async function attempt() {
  const child = spawn("head", ["-c", "10000000", "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
  const result = await Promise.race([
    readExactly(child.stdout, 300_000).then(() => "ok"),
    new Promise((resolve) => setTimeout(() => resolve("stalled"), 1000)),
  ]);
  const buffered = child.stdout.readableLength;
  child.kill();
  return { result, buffered };
}
(async () => {
  let stalls = 0, buffered;
  for (let i = 0; i < 10; i++) { const run = await attempt(); if (run.result === "stalled") { stalls++; buffered = run.buffered; } }
  const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}+${Bun.revision.slice(0, 9)}` : `node ${process.version}`;
  console.log(`${runtime}: ${stalls}/10 stalled` + (stalls ? ` (${buffered} bytes buffered, no "readable" event)` : ""));
  process.exit(0);
})();
