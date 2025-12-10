#!/usr/bin/env bun
/**
 * Extracts link command and creates bun-link-artifacts.tar.gz
 * Only includes object and library files needed for linking (.o/.a on Unix, .obj/.lib on Windows)
 * Files are placed under an artifacts/ prefix in the tarball
 *
 * Usage: bun scripts/create-link-artifacts.mjs <build-path> <bun-target>
 */

import { $, Glob } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";

console.time("create-link-artifacts");

const [buildPath, bunTarget] = process.argv.slice(2);

if (!buildPath || !bunTarget) {
  console.error("Usage: bun scripts/create-link-artifacts.mjs <build-path> <bun-target>");
  process.exit(1);
}

// Step 1: Extract link command using ninja
console.time("extract-link-command");
const linkCommandPath = join(buildPath, "link-command.txt");
const result = await $`ninja -C ${buildPath} -t commands ${bunTarget}`.quiet();
await Bun.write(linkCommandPath, result.stdout);
console.timeEnd("extract-link-command");

// Step 2: Determine library name based on platform
const libName = process.platform === "win32" ? `${bunTarget}.lib` : `lib${bunTarget}.a`;

const artifactsDir = join(buildPath, "artifacts");
const tarballPath = join(buildPath, "bun-link-artifacts.tar.zst");

// Step 3: Create artifacts directory
rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });

// Step 4: Copy files
console.time("copy-artifacts");

// Direct files to copy
const directFiles = ["link-command.txt", "bun-zig.o", libName];

for (const file of directFiles) {
  const src = join(buildPath, file);
  const dst = join(artifactsDir, file);
  if (existsSync(src)) {
    cpSync(src, dst);
  } else {
    console.warn(`  Warning: ${file} not found, skipping`);
  }
}

// Directories to scan for .o and .a files only
const dirs = [
  "mimalloc",
  "cache",
  "boringssl",
  "brotli",
  "cares",
  "highway",
  "libdeflate",
  "lolhtml",
  "lshpack",
  "tinycc",
  "zlib",
  "libarchive",
  "hdrhistogram",
  "zstd",
];

// Find and copy only object and library files, preserving directory structure
// Windows uses .obj and .lib, Unix uses .o and .a
const globPattern = process.platform === "win32" ? "**/*.{obj,lib}" : "**/*.{o,a}";
const glob = new Glob(globPattern);

for (const dir of dirs) {
  const srcDir = join(buildPath, dir);
  if (!existsSync(srcDir)) {
    console.warn(`  Warning: ${dir} not found, skipping`);
    continue;
  }

  for await (const file of glob.scan({ cwd: srcDir, absolute: false })) {
    const src = join(srcDir, file);
    const dst = join(artifactsDir, dir, file);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
}

console.timeEnd("copy-artifacts");

// Step 5: Create tarball
console.time("create-tarball");
await $`tar -cf - -C ${buildPath} artifacts | zstd -T0 -1 -o ${tarballPath}`.quiet();
console.timeEnd("create-tarball");

// Step 6: Cleanup
rmSync(artifactsDir, { recursive: true });

console.timeEnd("create-link-artifacts");
