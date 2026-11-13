// head -c SIZE /dev/zero to child.stdout (ROUTE=std) or to stdio[3] (ROUTE=fd); a counting 'data' listener.
const { spawn } = require("node:child_process");
const SIZE = +process.env.SIZE || 1024 * 1024 * 1024, route = process.env.ROUTE || "std";
const child = route === "std"
  ? spawn("sh", ["-c", `head -c ${SIZE} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] })
  : spawn("sh", ["-c", `head -c ${SIZE} /dev/zero >&3`], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
const s = route === "std" ? child.stdout : child.stdio[3];
let n = 0, bytes = 0; const t0 = Date.now();
s.on("data", chunk => { n++; bytes += chunk.length; });
s.on("end", () => console.log(JSON.stringify({ route, n, bytes, ms: Date.now() - t0 })));
