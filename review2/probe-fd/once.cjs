// R1 "calls the listener once when the child writes without gaps" on fd N
const { spawn } = require("node:child_process");
const fd = +process.argv[2];
const c = spawn(process.execPath, ["-e", `const fs = require("fs"); const b = Buffer.alloc(4 * 1024 * 1024, 97); for (let w = 0; w < b.length; ) w += fs.writeSync(${fd}, b, w);`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
let calls = 0; const seen = [];
const s = c.stdio[fd];
s.on("data", () => { calls++; throw new Error("data-throw-fatal"); });
s.on("end", () => seen.push("end"));
s.on("close", () => seen.push("close"));
process.on("exit", code => console.log(JSON.stringify({ code, calls, seen })));
