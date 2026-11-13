const { spawn } = require("child_process");
const c = spawn(process.execPath, ["-e", "process.stdout.write('a'); setTimeout(()=>process.stdout.write('b'), 50)"]);
let n = 0;
process.on("uncaughtException", e => console.log("uncaught", e.message));
process.on("unhandledRejection", e => console.log("unhandledRejection", e.message));
c.stdout.on("data", d => { n++; console.log("data", String(d)); if (n === 1) throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("close", code => console.log("close", code));
