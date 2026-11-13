// destroy() inside a 'data' listener. argv[2]: fd3 (raw stdio[3] socket) | std (child.stdout) | tcp
const { spawn } = require("node:child_process");
const mode = process.argv[2];
const writer = fd => `const fs=require("fs"); const c = Buffer.alloc(1 << 16, 97); try { for (let w = 0; w < ${8 * 1024 * 1024}; w += c.length) fs.writeSync(${fd}, c); } catch { process.exit(0); }`;
const events = [];
function watch(stream, done) {
  let calls = 0;
  stream.on("data", () => { if (++calls > 1) return events.push("data after destroy"); stream.destroy(); events.push("destroyed"); });
  stream.on("end", () => events.push("end"));
  stream.on("error", e => events.push("error " + e.code));
  stream.on("close", () => events.push("stream close"));
}
if (mode === "tcp") {
  const net = require("node:net");
  const server = net.createServer(s => { s.on("error", () => {}); s.write(Buffer.alloc(1 << 20, 97)); }).listen(0, "127.0.0.1", () => {
    const c = net.connect(server.address().port, "127.0.0.1");
    watch(c);
    c.on("close", () => { server.close(); setImmediate(() => console.log(JSON.stringify({ mode, events }))); });
  });
} else {
  const child = mode === "fd3"
    ? spawn(process.execPath, ["-e", writer(3)], { stdio: ["ignore", "ignore", "inherit", "pipe"] })
    : spawn(process.execPath, ["-e", writer(1)], { stdio: ["ignore", "pipe", "inherit"] });
  watch(mode === "fd3" ? child.stdio[3] : child.stdout);
  child.on("close", (code, signal) => setImmediate(() => console.log(JSON.stringify({ mode, events, code, signal }))));
}
