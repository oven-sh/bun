// Order of: socket push (data arrival), child 'exit' callback, child 'close'. No listener on the socket. Waits 300 ms before printing.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const cmd = process.argv[3] || `head -c 3000 /dev/zero >&${fd}`;
const readInExit = process.argv[4] !== "noread";
const log = [];
const t0 = process.hrtime.bigint();
const at = () => (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2);
const c = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
const s = c.stdio[fd];
const push = s.push;
s.push = function (chunk) { log.push(`push(${chunk === null ? "null" : chunk.length}) @${at()}`); return push.apply(this, arguments); };
s.on("end", () => log.push(`end @${at()}`));
s.on("close", () => log.push(`stream close @${at()}`));
c.on("exit", () => { if (readInExit) { const chunk = s.read(); log.push(`exit: read() -> ${chunk === null ? null : chunk.length} readableLength=${s.readableLength} @${at()}`); } else log.push(`exit: readableLength=${s.readableLength} @${at()}`); });
c.on("close", code => { log.push(`child close ${code} readableLength=${s.readableLength} @${at()}`); });
setTimeout(() => { log.push(`timer: readableLength=${s.readableLength} destroyed=${s.destroyed} @${at()}`); console.log(log.join("\n")); }, 300);
