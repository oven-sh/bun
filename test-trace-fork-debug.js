const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

console.log("Script started with argv:", process.argv);

// Look for 'child' argument anywhere in argv
const isChild = process.argv.includes("child");

if (isChild) {
  console.log("=== CHILD PROCESS ===");
  console.log("Child CWD:", process.cwd());
  console.log("Child argv:", process.argv);
  console.log("Child execArgv:", process.execArgv);

  // Do some work to trigger trace events
  setImmediate(() => {
    console.log("Immediate callback");
  });

  setTimeout(() => {
    console.log("Timer callback");

    // List files before exit
    const files = fs.readdirSync(".");
    console.log(
      "Files in CWD:",
      files.filter(f => f.includes("trace")),
    );
  }, 10);

  // Exit after a short delay
  setTimeout(() => {
    console.log("Child exiting...");
    process.exit(0);
  }, 50);
} else {
  console.log("=== PARENT PROCESS ===");
  const tmpdir = path.join(os.tmpdir(), "trace-test-" + Date.now());
  fs.mkdirSync(tmpdir, { recursive: true });
  console.log("Test tmpdir:", tmpdir);

  console.log("Parent forking child...");
  const child = cp.fork(__filename, ["child"], {
    cwd: tmpdir,
    execArgv: ["--trace-event-categories", "node.environment"],
  });

  child.on("exit", code => {
    console.log("\nChild exited with code:", code);

    // Check for trace file
    const traceFile = path.join(tmpdir, "node_trace.1.log");
    console.log("Looking for trace file:", traceFile);
    console.log("Trace file exists:", fs.existsSync(traceFile));

    // List all files in tmpdir
    const files = fs.readdirSync(tmpdir);
    console.log("Files in tmpdir:", files);

    if (fs.existsSync(traceFile)) {
      const content = fs.readFileSync(traceFile, "utf8");
      console.log("Trace file size:", content.length, "bytes");
      try {
        const data = JSON.parse(content);
        console.log("Trace events count:", data.traceEvents?.length || 0);
      } catch (e) {
        console.log("Failed to parse trace file:", e.message);
      }
    }

    // Cleanup
    fs.rmSync(tmpdir, { recursive: true });
  });
}
