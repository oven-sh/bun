// 1 GiB through child.stdout with a plain 'data' listener.
const { spawn } = require("node:child_process");
const SIZE = +(process.env.SIZE || 1024 * 1024 * 1024);
const c = spawn("head", ["-c", String(SIZE), "/dev/zero"], { stdio: ["ignore", "pipe", "inherit"] });
let chunks = 0, bytes = 0;
const t0 = process.hrtime.bigint(), cpu0 = process.cpuUsage();
c.stdout.on("data", d => { chunks++; bytes += d.length; });
c.stdout.on("end", () => {
  const ms = Number(process.hrtime.bigint() - t0) / 1e6, cpu = process.cpuUsage(cpu0);
  console.log(JSON.stringify({ mibps: Math.round(bytes / 1048576 / (ms / 1000)), ms: Math.round(ms), userMs: Math.round(cpu.user / 1000), sysMs: Math.round(cpu.system / 1000), chunks }));
});
