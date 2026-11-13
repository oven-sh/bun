const { spawn } = require("node:child_process");
const path = require("node:path");
const { waitFor, mark } = require("./waitfor.js");
const fd = +process.argv[2];
const child = spawn(process.execPath, [path.join(__dirname, "r3-writer.js"), String(fd)], { stdio: ["ignore", "pipe", "inherit", "pipe"] });
const s = child.stdio[fd];
const order = [];
let n = 0;
s.once("resume", () => mark("go1"));
s.on("data", chunk => {
  const k = ++n;
  order.push("d" + k + "=" + chunk);
  process.nextTick(() => order.push("t" + k));
  Promise.resolve().then(() => order.push("j" + k));
  if (k === 1) { mark("go2"); waitFor("written2"); }
});
s.on("end", () => order.push("end"));
if (fd !== 1) child.stdout.resume();
let code;
child.on("close", c => { code = c; });
process.on("exit", () => console.log(order.join(" ") + " close=" + code));
