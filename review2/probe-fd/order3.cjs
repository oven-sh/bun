// As order2.cjs, with knobs: PRELOAD=1 requires node:net first; WARM=1 spawns once before (so module init and first loop turn are done); DELAY=s sleeps in the child first.
const { spawn } = require("node:child_process");
if (process.env.PRELOAD) require("node:net");
const fd = +process.argv[2] || 3;
const delay = process.env.DELAY ? `sleep ${process.env.DELAY}; ` : "";
function run(done) {
  const log = [];
  const t0 = process.hrtime.bigint();
  const at = () => (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2);
  const c = spawn("sh", ["-c", `${delay}head -c 3000 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
  const s = c.stdio[fd];
  const push = s.push;
  s.push = function (chunk) { log.push(`push(${chunk === null ? "null" : chunk.length})`); return push.apply(this, arguments); };
  c.on("exit", () => { const chunk = s.read(); log.push(`exit:read()=${chunk === null ? null : chunk.length}`); });
  c.on("close", code => { log.push(`close`); });
  setTimeout(() => done(log.join(" ")), 150);
}
if (process.env.WARM) run(() => run(l => console.log(l)));
else run(l => console.log(l));
