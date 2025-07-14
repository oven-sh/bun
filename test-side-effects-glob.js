#!/usr/bin/env bun
import { mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const testDir = await mkdtemp(join(tmpdir(), "bun-sideeffects-test-"));

console.log("Test directory:", testDir);

// Create test files
await Bun.write(join(testDir, "package.json"), JSON.stringify({
  "name": "test-glob-side-effects",
  "sideEffects": ["src/lib/side-effects/*.js"]
}));

await Bun.write(join(testDir, "src/index.js"), `
import { used } from "./lib/used.js";
import { unused } from "./lib/unused.js";
import { sideEffectFile } from "./lib/side-effects/side-effect.js";
console.log("used:", used);
`);

await Bun.write(join(testDir, "src/lib/used.js"), `
export const used = "used";
`);

await Bun.write(join(testDir, "src/lib/unused.js"), `
export const unused = "unused";
console.log("This should be tree-shaken out");
`);

await Bun.write(join(testDir, "src/lib/side-effects/side-effect.js"), `
console.log("This is a side effect and should be preserved");
export const sideEffectFile = "side-effect";
`);

// Create directory structure
await Bun.spawn({
  cmd: ["mkdir", "-p", join(testDir, "src/lib/side-effects")],
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

console.log("Build stdout:", stdout);
console.log("Build stderr:", stderr);
console.log("Exit code:", await result.exited);

// Check if bundle was created
const bundleExists = await Bun.file(join(testDir, "dist/index.js")).exists();
console.log("Bundle exists:", bundleExists);

if (bundleExists) {
  const bundleContent = await Bun.file(join(testDir, "dist/index.js")).text();
  console.log("Bundle content:");
  console.log(bundleContent);
  
  // Check if the side effect is preserved
  const hasSideEffect = bundleContent.includes("This is a side effect and should be preserved");
  const hasUnusedCode = bundleContent.includes("This should be tree-shaken out");
  
  console.log("\nTest results:");
  console.log("✓ Side effect preserved:", hasSideEffect);
  console.log("✓ Unused code tree-shaken:", !hasUnusedCode);
  
  if (hasSideEffect && !hasUnusedCode) {
    console.log("\n🎉 Glob sideEffects test PASSED!");
  } else {
    console.log("\n❌ Glob sideEffects test FAILED!");
  }
}

// Clean up
await Bun.spawn({
  cmd: ["rm", "-rf", testDir],
}).exited;