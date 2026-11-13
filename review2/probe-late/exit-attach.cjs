// Child writes 5 pieces 60 ms apart, then exits. A 'data' listener is attached in 'exit'. No throws.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "printf 1; sleep 0.06; printf 2; sleep 0.06; printf 3; sleep 0.06; printf 4; sleep 0.06; printf 5"], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
c.on("exit", () => {
  log.push("exit");
  c.stdout.on("data", d => log.push("data:" + d));
  c.stdout.on("end", () => log.push("end"));
});
c.on("close", code => { log.push("close:" + code); console.log(log.join(" ")); });
