// No 'uncaughtException' handler. The child writes to stdout and to stderr and exits. The stdout listener throws.
// argv[2]: "nap" blocks the parent for 60 ms first, so everything is there when the loop turns; "sh" uses a shell child.
const { spawn } = require("node:child_process");
const how = process.argv[2];
const c = how === "sh" ? spawn("sh", ["-c", "printf out; printf err >&2"]) : spawn("/tmp/fz/w", ["oA:3", "ea:3", "x:0"], { stdio: ["ignore", "pipe", "pipe"] });
c.stdout.on("data", () => { console.log("stdout data"); throw new Error("boom"); });
c.stdout.on("end", () => console.log("stdout end"));
c.stderr.on("data", () => console.log("stderr data"));
c.stderr.on("end", () => console.log("stderr end"));
c.stderr.on("close", () => console.log("stderr close"));
c.on("exit", code => { console.log("child exit", code); process.exit(code); });
c.on("close", code => console.log("child close", code));
if (how === "nap") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
