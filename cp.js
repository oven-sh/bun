const { spawn } = require("child_process");
console.clear();
console.log("--start--");
const proc = spawn("sleep", ["0.5"], { stdio: ["ignore", "ignore", "ignore"] });

console.time("Elapsed");
process.on("exit", () => {
  console.timeEnd("Elapsed");
});
proc.on("exit", (code, signal) => {
  console.log(`child process terminated with code ${code} and signal ${signal}`);
  timer.unref();
});
proc.unref();

var timer = setTimeout(() => {}, 1000);
