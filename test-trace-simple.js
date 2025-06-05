const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("Starting trace test");
console.log("Process argv:", process.argv);
console.log("CWD:", process.cwd());

// Add some timers to trigger trace events
setImmediate(() => {
  console.log("Immediate callback");
});

setTimeout(() => {
  console.log("Timer callback");
}, 10);

// Exit after a short delay
setTimeout(() => {
  console.log("Exiting...");
  process.exit(0);
}, 50);

const tmpdir = "/tmp/trace-test-" + Date.now();
fs.mkdirSync(tmpdir);

console.log("Created temporary directory:", tmpdir);

const child = child_process.fork(process.argv[1], ["child"], {
  cwd: tmpdir,
  execArgv: ["--trace-event-categories", "node.environment"],
});

if (process.argv[2] === "child") {
  console.log("Child process running with execArgv:", process.execArgv);
  setImmediate(() => {
    console.log("setImmediate callback");
  });
  setTimeout(() => {
    console.log("setTimeout callback");
  }, 10);
  process.exit(0);
}

child.on("exit", () => {
  console.log("Child process exited");
  const traceFile = path.join(tmpdir, "node_trace.1.log");
  console.log("Looking for trace file:", traceFile);

  if (fs.existsSync(traceFile)) {
    console.log("Trace file found!");
    const content = fs.readFileSync(traceFile, "utf8");
    console.log("Trace file content:", content);

    try {
      const data = JSON.parse(content);
      console.log("Parsed trace events:", data.traceEvents.length, "events");
      const eventNames = new Set(data.traceEvents.filter(e => e.cat === "node.environment").map(e => e.name));
      console.log("Event names:", Array.from(eventNames));
    } catch (e) {
      console.error("Failed to parse trace file:", e);
    }
  } else {
    console.log("Trace file NOT found");
  }

  fs.rmSync(tmpdir, { recursive: true });
});
