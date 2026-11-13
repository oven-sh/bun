// No 'uncaughtException' handler. Listener attached in the child's 'exit' throws on every chunk. The child wrote 5 paced pieces (argv[2]=paced) or one piece (argv[2]=once).
const { spawn } = require("child_process");
const script = process.argv[2] === "once" ? "printf 12345" : "printf 1; sleep 0.06; printf 2; sleep 0.06; printf 3; sleep 0.06; printf 4; sleep 0.06; printf 5";
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
const fs = require("fs");
c.on("exit", () => {
  fs.writeSync(1, "exit ");
  c.stdout.on("data", d => { fs.writeSync(1, "data:" + d + " "); throw new Error("boom"); });
  c.stdout.on("end", () => fs.writeSync(1, "end "));
});
c.on("close", code => { fs.writeSync(1, "close:" + code + " "); process.exit(code); });
process.on("exit", code => fs.writeSync(1, "| process exit " + code));
