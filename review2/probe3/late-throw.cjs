// The child writes 3 chunks and exits before anything reads stdout. A 'data' listener attached in 'exit' throws on every chunk.
const { spawn } = require("child_process");
const when = process.argv[2] || "exit";
const c = spawn("sh", ["-c", "printf a; sleep 0.1; printf b; sleep 0.1; printf c"], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
process.on("uncaughtException", e => log.push("uncaught:" + e.message));
process.on("unhandledRejection", e => log.push("unhandledRejection:" + (e && e.message)));
function attach() {
  c.stdout.on("data", d => { log.push("data:" + d); throw new Error("boom-" + d); });
  c.stdout.on("end", () => log.push("end"));
}
if (when === "exit") c.on("exit", () => { log.push("exit"); attach(); });
else if (when === "late") setTimeout(() => { log.push("late-attach"); attach(); }, 250);
c.on("close", code => log.push("close:" + code));
setTimeout(() => { console.log(when + " => " + log.join(" | ")); process.exit(0); }, 1500);
