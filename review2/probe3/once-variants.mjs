import { spawn } from "node:child_process";
const SIZE = 3_000_000, how = process.argv[2];
const c = spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let bytes = 0;
if (how === "forawait") { for await (const d of c.stdout) bytes += d.length; }
else await new Promise(resolve => {
  function onData(d) { bytes += d.length; c.stdout.off("data", onData);
    if (how === "tick") process.nextTick(() => c.stdout.on("data", onData));
    else if (how === "immediate") setImmediate(() => c.stdout.on("data", onData));
    else queueMicrotask(() => c.stdout.on("data", onData)); }
  c.stdout.on("data", onData); c.on("close", resolve);
});
console.log(JSON.stringify({ how, lost: SIZE - bytes }));
process.exit(0);
