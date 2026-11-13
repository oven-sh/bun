// head -c SIZE /dev/zero into child.stdout; reports wall, user, sys, faults, maxRSS of the parent.
const { spawn } = require("node:child_process");
const SIZE = +process.env.SIZE || 1024 * 1024 * 1024;
const keep = process.env.KEEP === "1";
const t0 = process.hrtime.bigint();
const child = spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0; const chunks = [];
child.stdout.on("data", chunk => { n++; bytes += chunk.length; if (keep) chunks.push(chunk); });
child.on("close", () => {
  let total = 0;
  if (keep) total = Buffer.concat(chunks).length;
  const ru = process.resourceUsage();
  console.log(JSON.stringify({ n, bytes, wall_ms: Number((process.hrtime.bigint() - t0) / 1000000n), user_ms: Math.round(ru.userCPUTime / 1000), sys_ms: Math.round(ru.systemCPUTime / 1000), minflt: ru.minorPageFault, maxrss_mb: Math.round(ru.maxRSS / 1024), total }));
});
