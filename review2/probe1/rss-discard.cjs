const { spawn } = require("node:child_process");
const SIZE = +process.env.SIZE || 1024 * 1024 * 1024;
const child = spawn("sh", ["-c", `head -c ${SIZE} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, bytes = 0, peak = 0;
child.stdout.on("data", chunk => { n++; bytes += chunk.length; if ((n & 255) === 0) { const r = process.memoryUsage().rss; if (r > peak) peak = r; } });
child.on("close", () => console.log(JSON.stringify({ n, bytes, peakRssMB: Math.round(peak / 1048576), endRssMB: Math.round(process.memoryUsage().rss / 1048576) })));
