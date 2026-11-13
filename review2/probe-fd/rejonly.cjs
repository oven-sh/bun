// R1 "is fatal with only an 'unhandledRejection' handler" on fd N
const { spawn } = require("node:child_process");
const fd = +process.argv[2];
process.on("unhandledRejection", () => console.log("unhandledRejection"));
const c = spawn(process.execPath, ["-e", `setTimeout(() => require("fs").writeSync(${fd}, "hi\\n"), 50)`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
c.stdio[fd].on("data", () => { throw new Error("data-throw-fatal"); });
