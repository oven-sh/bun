// 150 concurrent children, each writes 2 MB to stdout and 64 KB to stderr; count bytes, time and RSS.
const { spawn } = require("child_process");
const N = 150; let closed = 0, out = 0, err = 0; const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const c = spawn("sh", ["-c", "head -c 2000000 /dev/zero; head -c 65536 /dev/zero >&2"]);
  c.stdout.on("data", d => { out += d.length; });
  c.stderr.on("data", d => { err += d.length; });
  c.on("close", () => { if (++closed === N) { const ru = process.resourceUsage(); console.log(JSON.stringify({ out, err, ok: out === N * 2000000 && err === N * 65536, wall_ms: Date.now() - t0, user_ms: Math.round(ru.userCPUTime / 1000), sys_ms: Math.round(ru.systemCPUTime / 1000), maxrss_mb: Math.round(ru.maxRSS / 1024) })); } });
}
