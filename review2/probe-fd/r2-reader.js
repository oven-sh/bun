const { spawn } = require("node:child_process");
const path = require("node:path");
const { waitFor, mark } = require("./waitfor.js");
const fd = +process.argv[2], BLOCKS = 6;
const child = spawn(process.execPath, [path.join(__dirname, "r2-writer.js"), String(fd)], { stdio: ["ignore", "pipe", "inherit", "pipe"] });
const out = child.stdio[fd];
if (fd !== 1) child.stdout.resume();
const got = [];
let end = 0;
function onData(chunk) {
  got.push(chunk);
  const k = chunk[chunk.length - 1] - 97;
  mark("seen" + k);
  if (k + 1 < BLOCKS) waitFor("written" + (k + 1));
  out.removeListener("data", onData);
  Promise.resolve().then(() => out.on("data", onData));
}
out.on("data", onData);
out.on("end", () => end++);
process.on("exit", () => {
  const runs = Buffer.concat(got).toString("latin1").replace(/(.)\1*/g, run => run[0] + run.length + " ").trim();
  console.log(runs + " end=" + end);
});
