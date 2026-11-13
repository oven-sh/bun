// Rows A/C of /tmp/probe3/late-throw2.cjs without the 2 s timer: what does the program itself see? argv: <throwsOn: all|N>
const { spawn } = require("child_process");
const throwsOn = process.argv[2];
const c = spawn("sh", ["-c", "printf 1; sleep 0.06; printf 2; sleep 0.06; printf 3; sleep 0.06; printf 4; sleep 0.06; printf 5"], { stdio: ["ignore", "pipe", "ignore"] });
const log = []; let n = 0;
process.on("uncaughtException", () => log.push("U"));
c.on("exit", () => {
  log.push("exit");
  c.stdout.on("data", d => { n++; log.push("data:" + d); if (throwsOn === "all" || n <= +throwsOn) throw new Error("boom"); });
  c.stdout.on("end", () => log.push("end"));
});
c.on("close", code => log.push("close:" + code));
process.on("exit", code => console.log(log.join(" ") + " | process exit " + code));
