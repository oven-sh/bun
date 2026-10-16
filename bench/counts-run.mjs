import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [BIN, kind, state] = process.argv.slice(2);
let stdout = "ignore", fifo, readFd, writeFd, dir;
if (state === "parked") {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnt-")); fifo = path.join(dir, "p");
  Bun.spawnSync({ cmd: ["mkfifo", fifo] });
  readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
  stdout = writeFd;
}
const proc = Bun.spawn({ cmd: [BIN, process.env.SCRIPT ?? "/tmp/bench/counts.js", kind, state], stdin: "ignore", stdout, stderr: "pipe", env: { ...process.env, FIFO: fifo ?? "", X_UNUSED: "0" } });
if (writeFd) fs.closeSync(writeFd);
const t = setTimeout(() => proc.kill(), 30000);
console.log((await proc.stderr.text()).trim().split("\n").at(-1)); await proc.exited; clearTimeout(t);
if (readFd) { fs.closeSync(readFd); fs.rmSync(dir, { recursive: true, force: true }); }
