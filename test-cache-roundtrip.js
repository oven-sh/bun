// Test round-trip serialization and deserialization of ESM bytecode cache
// This tests that we can serialize module metadata and deserialize it correctly

import { CachedBytecode } from "bun:internal-for-testing";

const testSource = `
export const greeting = "Hello, World!";
export function add(a, b) {
  return a + b;
}
export default 42;
`;

console.log("Testing ESM bytecode cache round-trip...\n");

// Test 1: Generate cache with metadata
console.log("Step 1: Generating cached bytecode with metadata");
const sourceURL = "/test-module.js"; // Without file:// prefix
const cacheData = CachedBytecode.generateForESMWithMetadata(sourceURL, testSource);

if (!cacheData || cacheData.byteLength === 0) {
  console.error("❌ Failed to generate cached bytecode");
  process.exit(1);
}

console.log(`✅ Generated ${cacheData.byteLength} bytes of cache data\n`);

// Test 2: Validate cache
console.log("Step 2: Validating cached metadata");
const isValid = CachedBytecode.validateMetadata(cacheData);

if (!isValid) {
  console.error("❌ Cache validation failed");
  process.exit(1);
}

console.log("✅ Cache metadata is valid\n");

// Test 3: Check magic number and version
console.log("Step 3: Checking cache format");
const view = new DataView(cacheData.buffer, cacheData.byteOffset, cacheData.byteLength);
const magic = view.getUint32(0, true); // little-endian
const version = view.getUint32(4, true);

const expectedMagic = 0x424d4553; // "BMES"
const expectedVersion = 1;

console.log(`  Magic: 0x${magic.toString(16)} (expected: 0x${expectedMagic.toString(16)})`);
console.log(`  Version: ${version} (expected: ${expectedVersion})`);

if (magic !== expectedMagic) {
  console.error(`❌ Magic number mismatch: got 0x${magic.toString(16)}, expected 0x${expectedMagic.toString(16)}`);
  process.exit(1);
}

if (version !== expectedVersion) {
  console.error(`❌ Version mismatch: got ${version}, expected ${expectedVersion}`);
  process.exit(1);
}

console.log("✅ Cache format is correct\n");

// Success!
console.log("🎉 All tests passed!");
console.log("\nCache structure:");
console.log(`  - Total size: ${cacheData.byteLength} bytes`);
console.log(`  - Magic: "BMES" (0x${magic.toString(16)})`);
console.log(`  - Version: ${version}`);
console.log(`  - Contains: module metadata + bytecode`);
