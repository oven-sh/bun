// Minimal reproduction for issue #23316
// https://github.com/oven-sh/bun/issues/23316
//
// This reproduces the UV_ENOTCONN panic when spawning a process
// with a cwd >= MAX_PATH (260 characters) on Windows
//
// Run: bun repro-23316.js

import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

if (process.platform !== "win32") {
  console.log("This reproduction only affects Windows");
  process.exit(0);
}

// Create a temp directory with a very long path
const baseDir = join(tmpdir(), "bun-test-long-path");
mkdirSync(baseDir, { recursive: true });

// Build a path > 260 characters (MAX_PATH)
let longPath = baseDir;
let segment = 0;
while (longPath.length < 280) {
  const dirName = `very_long_directory_name_to_exceed_max_path_${segment}`;
  longPath = join(longPath, dirName);
  mkdirSync(longPath, { recursive: true });
  segment++;
}

console.log(`Created path with length ${longPath.length}: ${longPath}`);

// Create a simple file to execute
const testFile = join(longPath, "test.js");
writeFileSync(testFile, 'console.log("hello");');

console.log("\nAttempting to spawn process with long cwd...");
console.log("Expected: Should either succeed or fail with proper error");
console.log("Bug: Will panic with 'UV_ENOTCONN: Transport endpoint is not connected'\n");

try {
  const proc = Bun.spawn({
    cmd: [process.execPath, "--version"],
    cwd: longPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  console.log(`✓ Success! Process exited with code ${exitCode}`);
  console.log("The bug has been fixed!");
} catch (err) {
  console.error("✗ Error:", err.message);
  if (err.message.includes("UV_ENOTCONN") || err.message.includes("panic")) {
    console.error("\n🐛 BUG REPRODUCED! This is the UV_ENOTCONN panic.");
  } else {
    console.log("\n✓ Failed with proper error (not a panic), bug might be fixed");
  }
}
