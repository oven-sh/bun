const { spawn } = require("child_process");
const script = process.argv[2];
const c = spawn("sh", ["-c", script], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
const timer = setTimeout(() => { console.log("BLOCKED"); c.kill("SIGKILL"); process.exit(0); }, 1200);
c.on("exit", code => { clearTimeout(timer); console.log("exit"); process.exit(0); });
