// Order of: socket push (data arrival), child 'exit' callback, nextTick turns. No listener on the socket.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const cmd = process.argv[3] || `head -c 3000 /dev/zero >&${fd}`;
const log = [];
const t0 = process.hrtime.bigint();
const at = () => Number(process.hrtime.bigint() - t0) / 1e6;
const c = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
const s = c.stdio[fd];
const push = s.push;
s.push = function (chunk) { log.push(`push(${chunk === null ? "null" : chunk.length}) @${at().toFixed(2)}`); return push.apply(this, arguments); };
c.on("exit", () => { const chunk = s.read(); log.push(`exit: read() -> ${chunk === null ? null : chunk.length} readableLength=${s.readableLength} @${at().toFixed(2)}`); });
c.on("close", code => { log.push(`close ${code} @${at().toFixed(2)}`); console.log(log.join("\n")); });
