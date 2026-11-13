// No 'uncaughtException' handler. A 'data' listener on child.stdout throws. A wrapper forwards the child's exit code.
// argv[2..]: the child's command line.
const { spawn } = require("node:child_process");
const [cmd, ...args] = process.argv.slice(2);
const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
c.stdout.on("data", () => { throw new Error("boom"); });
c.on("exit", code => process.exit(code));
