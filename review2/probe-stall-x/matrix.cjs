// A 'data' listener on child.stdout that throws, with an 'uncaughtException' handler.
// argv: <mode> <throwsOn: once|twice|all>
//   direct      listener attached at spawn; each chunk comes straight from the read completion
//   pause-live  listener at spawn, pause(); 5 chunks pile up in the Readable; resume() while the child lives; chunk 6 and the EOF come later
//   pause-done  same, but the child has exited (EOF is in) before resume()
//   late-live   listener attached at 400 ms while the child lives; chunk 6 and the EOF come later
//   exit        listener attached in the child's 'exit'
const { spawn } = require("child_process");
const [mode, throwsOn = "once"] = process.argv.slice(2);
const live = "for i in 1 2 3 4 5; do printf $i; sleep 0.05; done; sleep 0.6; printf 6";
const done = "for i in 1 2 3 4 5; do printf $i; sleep 0.05; done";
const script = mode === "pause-done" || mode === "exit" ? done : live;
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
const log = [];
let n = 0, got = "";
process.on("uncaughtException", () => log.push("U"));
process.on("unhandledRejection", () => log.push("unhandledRejection"));
function attach() {
  c.stdout.on("data", d => {
    n++;
    got += d;
    log.push("data:" + d);
    if (throwsOn === "all" || (throwsOn === "once" && n === 1) || (throwsOn === "twice" && n <= 2)) throw new Error("boom");
  });
  c.stdout.on("end", () => log.push("end"));
}
if (mode === "direct") attach();
else if (mode === "pause-live" || mode === "pause-done") {
  attach();
  c.stdout.pause();
  setTimeout(() => { log.push("resume"); c.stdout.resume(); }, mode === "pause-live" ? 400 : 700);
} else if (mode === "late-live") setTimeout(() => { log.push("attach"); attach(); }, 400);
else if (mode === "exit") c.on("exit", () => { log.push("exit"); attach(); });
if (mode !== "exit") c.on("exit", () => log.push("exit"));
c.on("close", code => log.push("close:" + code));
setTimeout(() => {
  const want = script === live ? "123456" : "12345";
  console.log(`${mode}/${throwsOn}: ${log.join(" ")}  => got ${got.length}/${want.length} bytes, end=${log.includes("end")}, close=${log.some(x => x.startsWith("close"))}`);
  process.exit(0);
}, 2500);
