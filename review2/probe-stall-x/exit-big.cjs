// The child writes SIZE bytes and exits before anything reads stdout. A 'data' listener attached in 'exit' throws (handled).
// argv: <size> <throwsOn: once|twice|all>
const { spawn } = require("child_process");
const [size = "150000", throwsOn = "all"] = process.argv.slice(2);
const c = spawn("sh", ["-c", `head -c ${size} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
let n = 0, bytes = 0;
process.on("uncaughtException", () => log.push("U"));
process.on("unhandledRejection", () => log.push("unhandledRejection"));
c.on("exit", () => {
  log.push("exit");
  c.stdout.on("data", d => {
    n++;
    bytes += d.length;
    log.push("data:" + d.length);
    if (throwsOn === "all" || (throwsOn === "once" && n === 1) || (throwsOn === "twice" && n <= 2)) throw new Error("boom");
  });
  c.stdout.on("end", () => log.push("end"));
});
c.on("close", code => log.push("close:" + code));
const t = setTimeout(() => {
  console.log(`exit-big ${size}/${throwsOn}: ${log.join(" ")} => ${bytes}/${size} bytes, end=${log.includes("end")}, close=${log.some(x => x.startsWith("close"))}`);
  process.exit(0);
}, 2000);
