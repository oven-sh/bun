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
  console.log("Child argv:", process.argv);
  console.log("Child execArgv:", process.execArgv);

  // Check if we have the trace flag in argv
  const hasTraceFlag = process.argv.some(arg => arg.includes("trace-event-categories"));
  console.log("Has trace flag in argv:", hasTraceFlag);

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
    process.exit(0);
  }, 20);
} else {
  // Test 1: Using execArgv (what the Node.js test does)
  console.log("\n=== Test 1: Using execArgv ===");
  console.log("Parent forking child with execArgv...");
  const child1 = cp.fork(__filename, ["child"], {
    cwd: tmpdir,
    execArgv: ["--trace-event-categories", "node.environment"],
  });

  child1.on("exit", code => {
    console.log("Child1 exited with code:", code);

    // Check for trace file
    const traceFile = path.join(tmpdir, "node_trace.1.log");
    console.log("Looking for trace file:", traceFile);
    console.log("Trace file exists:", fs.existsSync(traceFile));

    // List all files in tmpdir
    const files = fs.readdirSync(tmpdir);
    console.log("Files in tmpdir:", files);

    // Test 2: Using spawn with args directly
    console.log("\n=== Test 2: Using spawn directly ===");
    const child2 = cp.spawn(process.execPath, ["--trace-event-categories", "node.environment", __filename, "child"], {
      cwd: tmpdir,
      stdio: "inherit",
    });

    child2.on("exit", code => {
      console.log("\nChild2 exited with code:", code);

      // Check for trace file again
      console.log("Looking for trace file:", traceFile);
      console.log("Trace file exists:", fs.existsSync(traceFile));

      // List all files in tmpdir
      const files2 = fs.readdirSync(tmpdir);
      console.log("Files in tmpdir:", files2);

      // Cleanup
      fs.rmSync(tmpdir, { recursive: true });
    });
  });
}
