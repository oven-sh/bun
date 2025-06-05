const fs = require("fs");
const path = require("path");

console.log("execArgv:", process.execArgv);

// Check if trace events module is available
try {
  const trace_events = require("node:trace_events");
  console.log("trace_events module loaded:", trace_events);
} catch (e) {
  console.error("Failed to load trace_events:", e.message);
}

// Give some time for trace events to be written
setTimeout(() => {
  const traceFile = path.join(process.cwd(), "node_trace.1.log");
  console.log("Checking for trace file:", traceFile);

  if (fs.existsSync(traceFile)) {
    const content = fs.readFileSync(traceFile, "utf8");
    console.log("Trace file exists! Content:", content);
  } else {
    console.log("Trace file does not exist");
  }

  process.exit(0);
}, 100);
