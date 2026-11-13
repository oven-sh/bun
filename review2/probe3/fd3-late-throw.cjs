// late-throw2.cjs on stdio[3]: chunks read ahead of a listener attached in 'exit' (or at N ms) that throws.
const { spawn } = require("child_process");
const [script, when, throwsOn] = process.argv.slice(2);
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
const s = c.stdio[3];
const log = []; let n = 0;
process.on("uncaughtException", e => log.push("U"));
process.on("unhandledRejection", e => log.push("unhandledRejection"));
function attach() {
  log.push("attach");
  s.on("data", d => { n++; log.push("data:" + d); if (throwsOn === "all" || n <= +throwsOn) throw new Error("boom"); });
  s.on("end", () => log.push("end"));
}
if (when === "exit") c.on("exit", () => { log.push("exit"); attach(); });
else setTimeout(attach, +when);
c.on("close", code => log.push("close:" + code));
setTimeout(() => { console.log(log.join(" ")); process.exit(0); }, 2000);
