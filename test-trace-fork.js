const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpdir = path.join(os.tmpdir(), "trace-test-" + Date.now());
fs.mkdirSync(tmpdir, { recursive: true });

console.log("Test tmpdir:", tmpdir);

if (process.argv[2] === "child") {
  console.log("Child process started");
  console.log("Child CWD:", process.cwd());
  console.log("Child execArgv:", process.execArgv);

  // Do some work to trigger trace events
  setImmediate(() => {
    console.log("Immediate callback");
  });

  setTimeout(() => {
    console.log("Timer callback");
  }, 10);

  setTimeout(() => {
    console.log("Child exiting...");
    // List files in current directory before exit
    const files = fs.readdirSync(".");
    console.log("Files in CWD:", files);
  }, 20);
} else {
  console.log("Parent forking child...");
  const child = cp.fork(__filename, ["child"], {
    cwd: tmpdir,
    execArgv: ["--trace-event-categories", "node.environment"],
  });

  child.on("exit", code => {
    console.log("Child exited with code:", code);

    // Check for trace file
    const traceFile = path.join(tmpdir, "node_trace.1.log");
    console.log("Looking for trace file:", traceFile);
    console.log("Trace file exists:", fs.existsSync(traceFile));

    // List all files in tmpdir
    const files = fs.readdirSync(tmpdir);
    console.log("Files in tmpdir:", files);

    // Cleanup
    fs.rmSync(tmpdir, { recursive: true });
  });
}
