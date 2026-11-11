// No 'uncaughtException' handler. sh exits at once; a grandchild keeps stdout open and waits for a line on fd 3.
// The parent sends that line from the child's 'exit' event, so the data and the EOF always arrive after 'exit'.
// A wrapper exits with the child's code on 'close'. No sleep anywhere.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "(read line <&3; printf hi) & exit 0"], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
let n = 0;
c.stdio[3].on("error", () => {});
c.stdout.on("data", () => { n++; console.log("data", n); throw new Error("boom"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", () => { console.log("exit"); c.stdio[3].end("\n"); });
c.on("close", code => { console.log("child close", code); process.exit(code); });
