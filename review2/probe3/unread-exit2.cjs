// Parent never reads stdout and waits for 'exit'. The child writes 300 KB in one burst or in two.
const { spawn } = require("child_process");
const script = process.argv[2];
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "ignore"] });
const timer = setTimeout(() => { console.log("BLOCKED"); c.kill("SIGKILL"); process.exit(0); }, 1200);
c.on("exit", code => { clearTimeout(timer); console.log("exit"); process.exit(0); });
