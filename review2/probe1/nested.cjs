// Listener spins the event loop synchronously via require() of an async (TLA) ES module.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(__dirname, "tla.mjs"), "await new Promise(r => setTimeout(r, 300)); export default 1;");
const child = spawn("sh", ["-c", "printf 1; sleep 0.1; printf 2; sleep 0.1; printf 3"], { stdio: ["ignore", "pipe", "inherit"] });
const order = [];
let n = 0;
child.stdout.on("data", d => {
  const k = ++n;
  order.push("in" + k + "=" + d);
  if (k === 1) { try { require("./tla.mjs"); } catch (e) { order.push("require-threw:" + e.code); } }
  order.push("out" + k);
});
child.stdout.on("end", () => order.push("end"));
child.on("close", code => console.log(order.join(" ") + " close=" + code));
