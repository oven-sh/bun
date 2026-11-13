// Is the pipe closed inside destroy(), or on a later turn of the event loop? The parent blocks its loop for 400 ms after destroy(); the child writes at 150 ms.
const { spawn } = require("child_process");
const child = `process.on("SIGPIPE", () => {}); const fs = require("fs"); setTimeout(() => { try { fs.writeSync(1, "x"); fs.writeSync(2, "write-ok"); } catch (e) { fs.writeSync(2, e.code); } }, 150);`;
const c = spawn("/tmp/rel/bun-arm", ["-e", child], { stdio: ["ignore", "pipe", "pipe"] });
let err = ""; c.stderr.on("data", d => (err += d));
c.stdout.destroy();
const until = Date.now() + 400; while (Date.now() < until) {}
c.on("close", (code, sig) => console.log("child's write at 150 ms:", JSON.stringify(err)));
