import { readdir, readdirSync, readFileSync, existsSync } from "node:fs";

console.log("Testing standalone support...");

// Let's test what file paths are actually available
const testPaths = [
  "/$bunfs/root/debug-readdir.ts",
  "/$bunfs/debug-readdir.ts",
  "/$bunfs/index.ts",
  "/debug-readdir.ts",
  "debug-readdir.ts",
];

for (const path of testPaths) {
  try {
    console.log(`Checking if '${path}' exists:`, existsSync(path));
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8");
      console.log(`Content preview: ${content.substring(0, 50)}...`);
    }
  } catch (err) {
    console.error(`Error reading '${path}':`, err.message);
  }
}

// Try to understand what's inside the bundle
// Test readdir on various paths
const pathsToTry = [
  "/$bunfs/",
  "/$bunfs",
  "/$bunfs/root/",
  "/$bunfs/root",
  "/",
];

for (const path of pathsToTry) {
  try {
    console.log(`Trying readdir on '${path}':`);
    const files = readdirSync(path);
    console.log("Files:", files);
    break;
  } catch (err) {
    console.error(`Readdir error on '${path}':`, err.message);
  }
}

process.exit(0);