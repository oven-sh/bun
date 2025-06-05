const { spawn } = require("child_process");
const path = require("path");

// Run the test with the debug build
const testPath = path.join(__dirname, "test/js/node/test/parallel/test-child-process-recv-handle.js");
const child = spawn("./build/debug/bun-debug", [testPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
});

let stdout = "";
let stderr = "";

child.stdout.on("data", data => {
  // Filter out debug output lines that start with [
  const lines = data.toString().split("\n");
  const filtered = lines.filter(line => !line.startsWith("[")).join("\n");
  if (filtered) {
    process.stdout.write(filtered);
  }
  stdout += data.toString();
});

child.stderr.on("data", data => {
  stderr += data.toString();
  process.stderr.write(data);
});

child.on("close", code => {
  if (code !== 0) {
    console.error("\nTest failed with exit code:", code);
    if (stdout.includes("AssertionError")) {
      // Extract and display the assertion error
      const errorStart = stdout.indexOf("AssertionError");
      const errorSection = stdout.substring(errorStart);
      console.error("\nAssertion Error Details:");
      console.error(errorSection.split("\n").slice(0, 10).join("\n"));
    }
  } else {
    console.log("\nTest passed!");
  }
});
