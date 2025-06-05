// Override spawn to see what arguments are passed
const originalSpawn = require("bun").spawn;
require("bun").spawn = function (options) {
  console.log("Bun.spawn called with:");
  console.log("  cmd:", options.cmd);
  console.log("  cwd:", options.cwd);
  console.log("  argv0:", options.argv0);
  // Don't actually spawn
  return {
    pid: 12345,
    stdin: null,
    stdout: null,
    stderr: null,
    kill: () => {},
    ref: () => {},
    unref: () => {},
    stdio: [],
  };
};

const cp = require("child_process");

console.log("Testing fork...");
try {
  const child = cp.fork("./test-child-simple.js", ["arg1", "arg2"], {
    cwd: "/tmp",
    execArgv: ["--trace-event-categories", "node.environment"],
  });
  console.log("Fork returned, pid:", child.pid);
} catch (e) {
  console.error("Fork failed:", e);
}
