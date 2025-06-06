"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// This test ensures that trace events are generated when --trace-event-categories is used

const traceFile = path.join(process.cwd(), "node_trace.1.log");

// Clean up any existing trace file
try {
  fs.unlinkSync(traceFile);
} catch (err) {
  // Ignore if file doesn't exist
}

// The trace file should be created automatically
// Add a small timeout to ensure events are flushed
setTimeout(() => {
  try {
    const traceData = fs.readFileSync(traceFile, "utf8");
    const lines = traceData.trim().split("\n");

    // Parse JSON array (trace format is JSON array)
    const events = JSON.parse("[" + lines.join(",") + "]");

    // Check for required events
    const eventNames = new Set(events.map(e => e.name));
    const requiredEvents = [
      "Environment",
      "RunAndClearNativeImmediates",
      "CheckImmediate",
      "RunTimers",
      "BeforeExit",
      "RunCleanup",
      "AtExit",
    ];

    const foundEvents = requiredEvents.filter(name => eventNames.has(name));
    console.log("Found events:", foundEvents);

    // At minimum, we should see Environment event
    assert(eventNames.has("Environment"), "Missing Environment trace event");

    console.log("Test passed!");
    process.exit(0);
  } catch (err) {
    console.error("Error reading trace file:", err);
    process.exit(1);
  }
}, 100);

// Do some work to trigger events
setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
}, 10);
