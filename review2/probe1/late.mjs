// Listener attached after an await (not in 'exit'). No 'uncaughtException' handler. Wrapper exits with the child's code.
import { spawn } from "node:child_process";
const c = spawn("sh", ["-c", "printf hi"], { stdio: ["ignore", "pipe", "ignore"] });
c.on("close", code => { console.log("child close", code); process.exit(code); });
await new Promise(r => setTimeout(r, 200));
c.stdout.on("data", () => { console.log("data"); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
