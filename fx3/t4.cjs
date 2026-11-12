const { spawn } = require("node:child_process");
const log = [];
const c = spawn(process.execPath, ["-e", 'process.stdout.write("out");'], { stdio: ["ignore", "pipe", "pipe"] });
let childClose = null;
c.on("close", code => { childClose = code; log.push("child close " + code); });
c.on("exit", () => {
  log.push("child exit; readableLength=" + c.stdout.readableLength + " ended=" + c.stdout._readableState.ended + " flowing=" + c.stdout.readableFlowing);
  c.stdout.on("data", d => { log.push("data " + d); process.nextTick(() => log.push("tick after data")); throw new Error("stdout-throw"); });
  c.stdout.on("end", () => log.push("end"));
  c.stdout.on("close", () => log.push("close"));
  c.stdout.on("resume", () => log.push("resume"));
});
process.on("exit", code => console.log(JSON.stringify({ log, childClose, code })));
