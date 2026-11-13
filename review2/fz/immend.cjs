// The 'data' listener yields to the event loop with setImmediate (as `await setImmediate()` from timers/promises does)
// and only then listens for 'end'. The child writes once and exits.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "printf hi"], { stdio: ["ignore", "pipe", "ignore"] });
const log = s => require("fs").writeSync(1, s + "\n");
c.stdout.once("data", d => {
  log("data");
  setImmediate(() => { log("immediate"); c.stdout.on("end", () => log("end seen by the late listener")); });
});
c.stdout.on("end", () => log("end"));
c.on("close", () => log("child close"));
