const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "head -c 1000000 /dev/zero; echo done >&2"], { stdio: ["ignore", "pipe", "pipe"] });
let err = ""; c.stderr.on("data", d => (err += d));
c.stdout.destroy();
c.on("close", (code, sig) => console.log(JSON.stringify(err.trim().replace(/\n/g, " | ").slice(0, 70))));
