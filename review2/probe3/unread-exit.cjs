// Parent never reads stdout and waits for 'exit'. How much can the child write before it blocks?
const { spawn } = require("child_process");
const size = process.argv[2];
const c = spawn("head", ["-c", size, "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
const t0 = Date.now();
const timer = setTimeout(() => { console.log(size, "BLOCKED (no exit in 1.5 s)"); c.kill("SIGKILL"); process.exit(0); }, 1500);
c.on("exit", code => { clearTimeout(timer); console.log(size, "exit", code, "after", Date.now() - t0, "ms"); process.exit(0); });
