// write syscalls made by 1000 x process.stdout.write, read from /proc/self/io (syscw). usage: syscw.js <nocb|cb>
const fs = require("node:fs");
const syscw = () => +/syscw: (\d+)/.exec(fs.readFileSync("/proc/self/io", "utf8"))[1];
const withCb = process.argv[2] === "cb";
let ran = 0;
process.stdout.write("warm\n");
const before = syscw();
for (let i = 0; i < 1000; i++) withCb ? process.stdout.write("hello world\n", () => { ran++; }) : process.stdout.write("hello world\n");
const during = syscw() - before;
setImmediate(() => setImmediate(() => {
  const total = syscw() - before;
  process.stderr.write(JSON.stringify({ duringLoop: during, afterCallbacks: total, callbacks: ran }) + "\n");
}));
