// A write is parked, the pipe breaks, and later (two turns after 'error') a small write is made.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
if (!process.env.FIFO) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "late-"));
  const fifo = path.join(dir, "fifo");
  spawnSync("mkfifo", [fifo]);
  const r = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const w = fs.openSync(fifo, fs.constants.O_WRONLY);
  const child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], { env: { ...process.env, FIFO: fifo }, stdio: ["ignore", w, "inherit"] });
  fs.closeSync(w); fs.closeSync(r);
  child.on("exit", code => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(code ?? 1); });
} else {
  const reopen = process.argv[2] === "reopen";
  const report = [];
  setTimeout(() => { fs.writeSync(2, "WATCHDOG " + JSON.stringify(report) + "\n"); process.exit(1); }, 5000);
  let readFd = fs.openSync(process.env.FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const out = process.stdout;
  out.on("error", e => {
    report.push("error:" + e.code);
    setImmediate(() => setImmediate(() => {
      if (reopen) readFd = fs.openSync(process.env.FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      const ret = out.write("b", e => {
        report.push("late:" + (e ? e.code : null));
        setImmediate(() => {
          let got = "";
          if (reopen) { try { const buf = Buffer.alloc(1 << 21); const n = fs.readSync(readFd, buf, 0, buf.length, null); got = ",read:" + n + ",tail:" + buf.subarray(Math.max(0, n - 1), n).toString(); } catch (e) { got = ",read:" + e.code; } }
          fs.writeSync(2, JSON.stringify(report) + got + "\n");
          process.exit(0);
        });
      });
      report.push("ret:" + ret);
    }));
  });
  out.write(Buffer.alloc((1 << 20) + 1, "a"), e => report.push("w0:" + (e ? e.code : null)));
  fs.closeSync(readFd);
}
