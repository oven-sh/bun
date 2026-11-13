const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", process.argv[2] || "printf hi"], { stdio: ["ignore", "pipe", "pipe"] });
let n = 0;
c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", () => console.log("exit"));
c.on("close", code => { console.log("child close", code); process.exit(code); });
