const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpdir = path.join(os.tmpdir(), "trace-test-" + Date.now());
fs.mkdirSync(tmpdir, { recursive: true });

console.log("Parent process started");
console.log("Test tmpdir:", tmpdir);

console.log("Forking child with execArgv...");
const child = cp.fork("./test-child-simple.js", [], {
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
      if (data.traceEvents) {
        console.log("Event names:", data.traceEvents.map(e => e.name).join(", "));
      }
    } catch (e) {
      console.log("Failed to parse trace file:", e.message);
    }
  }

  // Cleanup
  fs.rmSync(tmpdir, { recursive: true });
});
