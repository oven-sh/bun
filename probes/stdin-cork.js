const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "process.on('message', () => { require('node:fs').closeSync(0); process.send('closed'); })"], { stdio: ["pipe", "ignore", "inherit", "ipc"] });
const out = child.stdin;
const report = [];
setTimeout(() => { console.log("WATCHDOG " + JSON.stringify(report)); child.kill(); process.exit(1); }, 5000);
out.on("error", e => report.push("error:" + e.code));
out.on("close", () => report.push("close"));
out.cork();
out.write(Buffer.alloc((1 << 20) + 1, "a"), e => report.push("w0:" + (e ? e.code : null)));
out.write("b", e => report.push("w1:" + (e ? e.code : null)));
child.send("go");
child.on("message", () => {
  setTimeout(() => {
    report.push("uncork");
    out.uncork();
    setImmediate(() => setImmediate(() => {
      report.push("errored:" + (out.errored ? out.errored.code : null) + ",destroyed:" + out.destroyed);
      console.log(JSON.stringify(report));
      child.kill();
      process.exit(0);
    }));
  }, 300);
});
