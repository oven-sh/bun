// As /tmp/frame/r1c.cjs (data + EOF of stdout arrive after the child's 'exit'), but the consumer is a 'readable' listener (or an 'end' listener) that throws.
const { spawn } = require("node:child_process");
const mode = process.argv[2];
const c = spawn("sh", ["-c", "(read line <&3; printf hi) & exit 0"], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
let n = 0;
c.stdio[3].on("error", () => {});
if (mode === "readable") c.stdout.on("readable", () => { let d; while ((d = c.stdout.read()) !== null) { n++; console.log("readable", n); throw new Error("boom"); } });
if (mode === "end") { c.stdout.on("data", () => { console.log("data"); }); c.stdout.on("end", () => { console.log("end"); throw new Error("boom"); }); }
if (mode === "tick") c.stdout.on("data", () => { console.log("data"); process.nextTick(() => { throw new Error("boom"); }); });
if (mode === "data") c.stdout.on("data", () => { console.log("data"); throw new Error("boom"); });
c.on("exit", () => { console.log("exit"); c.stdio[3].end("\n"); });
c.on("close", code => { console.log("child close", code); process.exit(code); });
