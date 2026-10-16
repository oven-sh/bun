const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
if (!process.env.FIFO) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cork-"));
  const fifo = path.join(dir, "fifo");
  spawnSync("mkfifo", [fifo]);
  const r = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const w = fs.openSync(fifo, fs.constants.O_WRONLY);
  const child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], { env: { ...process.env, FIFO: fifo }, stdio: ["ignore", w, "inherit"] });
  fs.closeSync(w); fs.closeSync(r);
  child.on("exit", code => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(code ?? 1); });
} else {
  const size = Number(process.argv[2] ?? (1 << 20) + 1);
  const cork = process.argv[3] === "cork";
  setTimeout(() => { fs.writeSync(2, "WATCHDOG " + JSON.stringify(report) + "\n"); process.exit(1); }, 5000);
  const readFd = fs.openSync(process.env.FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const out = process.stdout;
  const report = [];
  out.on("error", e => report.push("error:" + e.code));
  out.on("close", () => report.push("close"));
  fs.closeSync(readFd); // the pipe is broken before the first write
  if (cork) out.cork();
  const ret = out.write(Buffer.alloc(size, "a"), e => report.push("w0:" + (e ? e.code : null)));
  report.push("ret:" + ret);
  out.write("b", e => report.push("w1:" + (e ? e.code : null)));
  setImmediate(() => {
    if (cork) { report.push("uncork"); out.uncork(); }
    setImmediate(() => setImmediate(() => {
      report.push("errored:" + (out.errored ? out.errored.code : null) + ",destroyed:" + out.destroyed);
      out.write("c", e => {
        report.push("late:" + (e ? e.code : null));
        fs.writeSync(2, JSON.stringify(report) + "\n");
        process.exit(0);
      });
    }));
  });
}
