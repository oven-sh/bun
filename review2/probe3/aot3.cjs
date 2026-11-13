const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "head -c 200000 /dev/zero; sleep 0.3"]);
const log = [];
c.on("exit", () => {
  log.push("hwm " + c.stdout._readableState.highWaterMark + " len-before " + c.stdout.readableLength);
  const b = c.stdout.read();
  log.push("read-in-exit " + (b ? b.length : b) + " len-after " + c.stdout.readableLength);
  let total = b ? b.length : 0;
  c.stdout.on("data", d => { total += d.length; });
  c.stdout.on("end", () => log.push("end total " + total));
});
c.on("close", code => { log.push("close " + code); console.log(log.join("\n")); });
