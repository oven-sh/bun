import { readdir, readdirSync, readFileSync, existsSync } from "node:fs";

// Create a file to embed
import "./foo.txt";

console.log("Testing standalone support...");

console.log("import.meta.path:", import.meta.path);
console.log("import.meta.url:", import.meta.url);

// Test import.meta.resolve approach
try {
  const resolvedPath = import.meta.require.resolve("./foo.txt");
  console.log("Resolved path:", resolvedPath);
  
  const content = await Bun.file(resolvedPath).text();
  console.log("File content via Bun.file:", content.trim());
  
  // Now try readFile on the resolved path
  const contentViaReadFile = readFileSync(resolvedPath, "utf8");
  console.log("File content via readFileSync:", contentViaReadFile.trim());
} catch (err) {
  console.error("Error with resolved path:", err.message);
}

// Try to understand what's inside the bundle by using the standalone path
console.log("Testing readdir on bundled paths...");

const pathsToTry = [
  "/$bunfs/root",
  "/$bunfs/root/",
  "/$bunfs/",
  "/$bunfs",
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