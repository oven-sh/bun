// As exit-attach.cjs, but the child starts writing late and paces slowly, so a slow (debug+ASAN) parent is at its event loop before the first write.
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "sleep 3; printf 1; sleep 0.5; printf 2; sleep 0.5; printf 3"], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
c.on("exit", () => {
  log.push("exit");
  c.stdout.on("data", d => log.push("data:" + d));
  c.stdout.on("end", () => log.push("end"));
});
c.on("close", code => { log.push("close:" + code); console.log(log.join(" ")); });
