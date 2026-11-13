const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "printf a; sleep 0.1; printf b; sleep 0.1; printf c"]);
let n = 0;
const log = [];
process.on("uncaughtException", e => log.push("uncaught " + e.message));
process.on("unhandledRejection", e => log.push("unhandledRejection " + e.message));
c.stdout.on("data", d => {
  n++;
  log.push("data " + String(d));
  process.nextTick(() => log.push("tick after " + String(d)));
  Promise.resolve().then(() => log.push("job after " + String(d)));
  if (n === 1) throw new Error("boom");
});
c.stdout.on("end", () => log.push("end"));
c.on("close", code => { log.push("close " + code); console.log(log.join("\n")); });
