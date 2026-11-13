// R1 on fd N: no 'uncaughtException' handler, gapless writer. Listener calls / end / close / exit code.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const c = spawn("sh", ["-c", `head -c 4194304 /dev/zero >&${fd}`], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
let calls = 0; const seen = [];
const s = c.stdio[fd];
s.on("data", () => { calls++; throw new Error("data-throw-fatal"); });
s.on("end", () => seen.push("end"));
s.on("close", () => seen.push("close"));
c.on("close", code => { seen.push("child close " + code); });
process.on("exit", code => console.log(JSON.stringify({ fd, code, calls, seen })));
