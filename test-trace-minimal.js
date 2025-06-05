// Minimal test to check if trace events are working
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Clean up any existing trace file
try {
  fs.unlinkSync("node_trace.1.log");
} catch (e) {}

console.log("Starting child process with trace events...");

const child = spawn(
  process.execPath,
  [
    "--trace-event-categories",
    "node.environment",
    "-e",
    'console.log("Hello from child process"); setTimeout(() => { console.log("Exiting..."); }, 10);',
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
);

child.on("exit", code => {
  console.log(`Child process exited with code ${code}`);

  // Check if trace file was created
  if (fs.existsSync("node_trace.1.log")) {
    console.log("✓ Trace file was created");
    const content = fs.readFileSync("node_trace.1.log", "utf8");
    console.log("Trace file content:", content);

    try {
      const data = JSON.parse(content);
      console.log("✓ Valid JSON");
      console.log("Trace events count:", data.traceEvents?.length || 0);
    } catch (e) {
      console.log("✗ Invalid JSON:", e.message);
    }
  } else {
    console.log("✗ Trace file was NOT created");
  }
});
