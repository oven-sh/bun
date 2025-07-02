import { readFileSync } from "fs";
import { join } from "path";

// Read the generated entry-a.js file
const content = readFileSync(join(import.meta.dir, "out/entry-a.js"), "utf8");

// Count occurrences of 'export { a };'
const exportMatches = content.match(/export\s*\{\s*a\s*\};/g) || [];
const exportCount = exportMatches.length;

console.log("File content:");
console.log(content);
console.log("\nExport count:", exportCount);

if (exportCount === 1) {
  console.log("✅ SUCCESS: Only one export statement found (duplicate exports fixed!)");
  process.exit(0);
} else {
  console.log("❌ FAILURE: Found", exportCount, "export statements (duplicate exports still present)");
  process.exit(1);
}
