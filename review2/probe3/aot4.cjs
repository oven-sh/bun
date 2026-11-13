// R2/R3 shape: a listener that removes itself and comes back from a promise job; gapless chunks then EOF.
const { spawn } = require("child_process");
const c = spawn("head", ["-c", "3000000", "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let bytes = 0, calls = 0, ticksSeen = 0, order = [];
function onData(d) {
  bytes += d.length; calls++;
  c.stdout.off("data", onData);
  process.nextTick(() => { ticksSeen++; });
  Promise.resolve().then(() => { c.stdout.on("data", onData); });
}
c.stdout.on("data", onData);
c.stdout.on("end", () => order.push("end"));
c.on("close", () => console.log(JSON.stringify({ bytes, lost: 3000000 - bytes, calls, ticksSeen, order })));
