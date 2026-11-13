// N sequential runs in one process (warm). Prints one line per run.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const N = +process.env.N || 10;
const delay = process.env.DELAY ? `sleep ${process.env.DELAY}; ` : "";
let i = 0;
function run() {
  if (i++ === N) return;
  const log = [];
  const c = spawn("sh", ["-c", `${delay}head -c 3000 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
  const s = c.stdio[fd];
  const push = s.push;
  s.push = function (chunk) { log.push(`push(${chunk === null ? "null" : chunk.length})`); return push.apply(this, arguments); };
  c.on("exit", () => { const chunk = s.read(); log.push(`exit:read()=${chunk === null ? null : chunk.length}`); });
  c.on("close", code => { log.push(`close`); });
  setTimeout(() => { console.log(`run ${i}: ` + log.join(" ")); run(); }, 60);
}
run();
