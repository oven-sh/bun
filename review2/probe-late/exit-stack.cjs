// Which frames deliver the read-ahead chunks to a listener attached in 'exit'? Prints the function names on the stack of each 'data' call, then throws (handled).
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "printf 1; sleep 0.06; printf 2; sleep 0.06; printf 3; sleep 0.06; printf 4"], { stdio: ["ignore", "pipe", "ignore"] });
process.on("uncaughtException", () => {});
c.on("exit", () => {
  c.stdout.on("data", d => {
    const frames = new Error().stack.split("\n").slice(1).map(l => l.trim().replace(/^at /, "").replace(/ \(.*$/, "")).filter(f => !f.startsWith("<anonymous>"));
    console.log("data:" + d + " <- " + frames.join(" <- "));
    throw new Error("boom");
  });
  c.stdout.on("end", () => console.log("end"));
});
c.on("close", code => console.log("close:" + code));
process.on("exit", () => console.log("readableLength at exit=" + c.stdout.readableLength + " readableEnded=" + c.stdout.readableEnded + " destroyed=" + c.stdout.destroyed));
