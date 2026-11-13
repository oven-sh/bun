// R1 "does not reach 'close', where a program would exit with the child's code". DATA fd is argv[2] (1 or 3); the trigger pipe is fd 4.
// COUNT=1 emulates Node's rule that the child's 'close' waits for every piped stream (missing for fd >= 3 on main; #33614).
const { spawn } = require("node:child_process");
const fd = +process.argv[2];
const c = spawn("sh", ["-c", `(read line <&4; printf hi >&${fd}) & exit 0`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore", "pipe"] });
c.stdio[4].on("error", () => {});
const s = c.stdio[fd];
s.on("data", () => { console.log("data"); throw new Error("data-throw-fatal"); });
s.on("end", () => console.log("end"));
c.on("exit", () => { console.log("exit"); c.stdio[4].end("\n"); });
const onClose = code => { console.log("close"); process.exit(code); };
if (process.env.COUNT && fd !== 1) { let left = 2, code; const done = () => { if (--left === 0) onClose(code); }; c.on("close", k => { code = k; done(); }); s.on("close", done); }
else c.on("close", onClose);
