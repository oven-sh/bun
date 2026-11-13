// pending top-level await keeps the run going after the report
import { spawn } from "node:child_process";
const c = spawn("sh", ["-c", "printf hi; sleep 0.3; printf there"]);
let n = 0;
c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => console.log("child exit", code));
const code = await new Promise(r => c.on("close", r));
console.log("child close", code);
process.exit(code);
