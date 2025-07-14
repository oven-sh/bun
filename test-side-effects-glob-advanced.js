#!/usr/bin/env bun
import { mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

async function testPattern(pattern, expectedFiles, testName) {
  const testDir = await mkdtemp(join(tmpdir(), "bun-sideeffects-test-"));
  
  console.log(`\n=== Test: ${testName} ===`);
  console.log("Pattern:", pattern);
  console.log("Test directory:", testDir);
  
  // Create test files
  await Bun.write(join(testDir, "package.json"), JSON.stringify({
    "name": "test-glob-side-effects",
    "sideEffects": [pattern]
  }));

  await Bun.write(join(testDir, "src/index.js"), `
import { used } from "./lib/used.js";
import { unused } from "./lib/unused.js";
import { file1 } from "./lib/effects/file1.js";
import { file2 } from "./lib/effects/file2.js";
import { fileA } from "./lib/effects/fileA.js";
import { fileB } from "./lib/effects/fileB.js";
import { special } from "./lib/special.js";
console.log("used:", used);
`);

  await Bun.write(join(testDir, "src/lib/used.js"), `
export const used = "used";
`);

  await Bun.write(join(testDir, "src/lib/unused.js"), `
export const unused = "unused";
console.log("This should be tree-shaken out");
`);

  await Bun.write(join(testDir, "src/lib/effects/file1.js"), `
console.log("file1 side effect");
export const file1 = "file1";
`);

  await Bun.write(join(testDir, "src/lib/effects/file2.js"), `
console.log("file2 side effect");
export const file2 = "file2";
`);

  await Bun.write(join(testDir, "src/lib/effects/fileA.js"), `
console.log("fileA side effect");
export const fileA = "fileA";
`);

  await Bun.write(join(testDir, "src/lib/effects/fileB.js"), `
console.log("fileB side effect");
export const fileB = "fileB";
`);

  await Bun.write(join(testDir, "src/lib/special.js"), `
console.log("special side effect");
export const special = "special";
`);

  // Create directory structure
  await Bun.spawn({
    cmd: ["mkdir", "-p", join(testDir, "src/lib/effects")],
    cwd: testDir,
  }).exited;

  // Test with our debug build
  const result = await Bun.spawn({
    cmd: ["/workspace/bun/build/debug/bun-debug", "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe"
  });

  const stdout = await new Response(result.stdout).text();
  const stderr = await new Response(result.stderr).text();
  const exitCode = await result.exited;

  console.log("Build stdout:", stdout);
  if (stderr) console.log("Build stderr:", stderr);
  console.log("Exit code:", exitCode);

  // Check if bundle was created
  const bundleExists = await Bun.file(join(testDir, "dist/index.js")).exists();
  console.log("Bundle exists:", bundleExists);

  if (bundleExists) {
    const bundleContent = await Bun.file(join(testDir, "dist/index.js")).text();
    console.log("Bundle content:");
    console.log(bundleContent);
    
    // Check which side effects are preserved
    const results = {};
    results.hasFile1 = bundleContent.includes("file1 side effect");
    results.hasFile2 = bundleContent.includes("file2 side effect");
    results.hasFileA = bundleContent.includes("fileA side effect");
    results.hasFileB = bundleContent.includes("fileB side effect");
    results.hasSpecial = bundleContent.includes("special side effect");
    results.hasUnused = bundleContent.includes("This should be tree-shaken out");
    
    console.log("\nTest results:");
    console.log("file1 side effect:", results.hasFile1);
    console.log("file2 side effect:", results.hasFile2);
    console.log("fileA side effect:", results.hasFileA);
    console.log("fileB side effect:", results.hasFileB);
    console.log("special side effect:", results.hasSpecial);
    console.log("unused code tree-shaken:", !results.hasUnused);
    
    // Check if expected files have side effects
    let passed = true;
    for (const expectedFile of expectedFiles) {
      const key = `has${expectedFile.charAt(0).toUpperCase() + expectedFile.slice(1)}`;
      if (!results[key]) {
        console.log(`❌ Expected ${expectedFile} to have side effects but it doesn't`);
        passed = false;
      }
    }
    
    // Check that unused code is tree-shaken
    if (results.hasUnused) {
      console.log("❌ Unused code should be tree-shaken but isn't");
      passed = false;
    }
    
    console.log(passed ? "🎉 PASSED!" : "❌ FAILED!");
  }

  // Clean up
  await Bun.spawn({
    cmd: ["rm", "-rf", testDir],
  }).exited;
  
  return bundleExists;
}

// Test different glob patterns
await testPattern("src/lib/effects/*.js", ["file1", "file2", "fileA", "fileB"], "Basic wildcard");
await testPattern("src/lib/effects/file?.js", ["file1", "file2"], "Question mark wildcard");
await testPattern("src/lib/effects/file[12].js", ["file1", "file2"], "Character class");
await testPattern("src/lib/effects/file[A-Z].js", ["fileA", "fileB"], "Character range");
await testPattern("src/lib/{effects/file1,special}.js", ["file1", "special"], "Brace expansion");