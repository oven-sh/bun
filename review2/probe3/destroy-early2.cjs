// Same with a child that reports the errno of the failing write.
const { spawn } = require("child_process");
const when = process.argv[2];
const child = `process.on("SIGPIPE", () => {}); const fs = require("fs"); ${when === "afterdata" ? 'fs.writeSync(1, "first");' : ""} setTimeout(() => { try { fs.writeSync(1, "second"); fs.writeSync(2, "write-ok"); } catch (e) { fs.writeSync(2, e.code); } }, 300);`;
const c = spawn("/tmp/rel/bun-arm", ["-e", child], { stdio: ["ignore", "pipe", "pipe"] });
let err = ""; c.stderr.on("data", d => (err += d));
if (when === "sync") c.stdout.destroy();
else if (when === "afterdata") setTimeout(() => c.stdout.destroy(), 150);
else if (when === "afterdata-listening") { c.stdout.on("data", () => {}); setTimeout(() => c.stdout.destroy(), 150); }
c.on("close", (code, sig) => console.log(when, JSON.stringify(err), code, sig));
