import { spawn } from "node:child_process";
const writer = `const fs = require("fs"); fs.writeSync(1, "hi");`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["ignore", "pipe", "ignore"] });
let calls = 0;
process.on("exit", code => console.log(JSON.stringify({ code, calls })));
child.stdout.on("data", () => { calls++; throw new Error("boom"); });
if (process.env.GUARD) setTimeout(() => process.exit(3), 2000).unref();
await new Promise(resolve => child.on("close", resolve));
console.log("closed");
