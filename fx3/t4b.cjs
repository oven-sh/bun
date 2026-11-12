const { spawn } = require("node:child_process");
const seen = { stdout: [], stderr: [] };
const c = spawn(process.execPath, ["-e", 'process.stdout.write("out"); process.stderr.write("err");'], { stdio: ["ignore", "pipe", "pipe"] });
function listen(name) {
  c[name].on("data", d => { seen[name].push("data " + d); if (process.env.TICK) process.nextTick(() => seen[name].push("tick")); throw new Error(name + "-throw"); });
  c[name].on("end", () => seen[name].push("end"));
  c[name].on("close", () => seen[name].push("close"));
}
let childClose = null;
c.on("close", code => (childClose = code));
c.on("exit", () => listen(process.env.NAME || "stdout"));
process.on("exit", exit => console.log(JSON.stringify({ events: seen[process.env.NAME || "stdout"], childClose, exit })));
