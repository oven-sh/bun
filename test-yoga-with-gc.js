#!/usr/bin/env bun

// Test script to run Yoga tests with forced GC between test files
import { spawn } from "bun";

const testFiles = [
  "./test/js/bun/yoga-node.test.js",
  "./test/js/bun/yoga-config.test.js", 
  "./test/js/bun/yoga-layout-comprehensive.test.js",
  "./test/js/bun/yoga-node-extended.test.js"
];

console.log("Running Yoga tests with GC isolation...");

for (let i = 0; i < testFiles.length; i++) {
  const testFile = testFiles[i];
  console.log(`\n=== Running ${testFile} ===`);
  
  const proc = Bun.spawn({
    cmd: ["./build/debug/bun-debug", "test", testFile],
    stdio: ["inherit", "inherit", "inherit"]
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`❌ Test failed: ${testFile} (exit code: ${exitCode})`);
    process.exit(exitCode);
  }
  
  console.log(`✅ Test passed: ${testFile}`);
  
  // Force garbage collection between tests
  if (global.gc) {
    console.log("🗑️  Forcing GC...");
    global.gc();
  }
  
  // Small delay to ensure complete cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
}

console.log("\n🎉 All Yoga tests passed!");