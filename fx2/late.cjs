// The child writes and exits before a listener attaches.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "head -c 300000 /dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
c.on("exit", () => setTimeout(() => {
  let n = 0; const ev = [];
  c.stdout.on("data", d => n += d.length);
  c.stdout.on("end", () => ev.push("end"));
  c.stdout.on("close", () => console.log("late: " + n + " of 300000 | " + ev.concat("close").join(" ")));
}, 300));
