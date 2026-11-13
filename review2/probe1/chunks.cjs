const { spawn } = require("node:child_process");
const child = spawn("sh", ["-c", "head -c 268435456 /dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0, max = 0, first = -1; const hist = {};
child.stdout.on("data", c => { n++; if (first < 0) first = c.length; if (c.length > max) max = c.length; const k = c.length > 262144 ? ">256K" : c.length > 131072 ? "128K-256K" : c.length > 65536 ? "64K-128K" : c.length === 65536 ? "=64K" : "<64K"; hist[k] = (hist[k] || 0) + 1; });
child.on("close", () => console.log(JSON.stringify({ hwm: child.stdout.readableHighWaterMark, first, max, n, hist })));
