// Variants of a throwing 'data' listener that meets chunks read ahead of it. argv: <script> <attachAtMs|exit> <throwsOn: all|first|N>
const { spawn } = require("child_process");
const [script, when, throwsOn] = process.argv.slice(2);
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
const log = []; let n = 0;
process.on("uncaughtException", e => log.push("U"));
process.on("unhandledRejection", e => log.push("unhandledRejection"));
function attach() {
  log.push("attach");
  c.stdout.on("data", d => { n++; log.push("data:" + d); if (throwsOn === "all" || (throwsOn === "first" && n === 1) || n <= +throwsOn) throw new Error("boom"); });
  c.stdout.on("end", () => log.push("end"));
}
if (when === "exit") c.on("exit", () => { log.push("exit"); attach(); });
else setTimeout(attach, +when);
c.on("exit", () => { if (when !== "exit") log.push("exit"); });
c.on("close", code => log.push("close:" + code));
setTimeout(() => { console.log(log.join(" ")); process.exit(0); }, 6000);
