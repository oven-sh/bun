# ESM Bytecode Cache - How to Use (Testing Phase)

## Current Status

The ESM bytecode cache with module metadata is **fully implemented** at the serialization/deserialization level. This document shows how to use the existing APIs for testing and experimentation.

**⚠️ Note**: Full ModuleLoader integration (automatic caching) is not yet implemented. This guide shows how to manually use the caching APIs.

## Prerequisites

- Bun debug build from the `bun-build-esm` branch
- Access to `bun:internal-for-testing` module

## Basic Usage

### 1. Generate Cache for a Module

```javascript
import { CachedBytecode } from "bun:internal-for-testing";

const sourceCode = `
export const greeting = "Hello, World!";
export function add(a, b) {
  return a + b;
}
export default { version: "1.0.0" };
`;

// Generate cache with metadata
const cache = CachedBytecode.generateForESMWithMetadata(
  "/path/to/module.js",  // Source URL (without file:// prefix)
  sourceCode              // Source code as string
);

if (cache) {
  console.log(`Cache generated: ${cache.byteLength} bytes`);
  // Save to file if needed
  await Bun.write("module.cache", cache);
}
```

### 2. Validate Cache

```javascript
import { CachedBytecode } from "bun:internal-for-testing";

// Read cache from file
const cache = new Uint8Array(await Bun.file("module.cache").arrayBuffer());

// Validate cache
if (CachedBytecode.validateMetadata(cache)) {
  console.log("Cache is valid!");
} else {
  console.error("Cache is invalid or corrupted");
}
```

### 3. Inspect Cache Structure

```javascript
const view = new DataView(cache.buffer, cache.byteOffset, cache.byteLength);

// Read magic number (should be 0x424D4553 = "BMES")
const magic = view.getUint32(0, true);
console.log(`Magic: 0x${magic.toString(16)}`);

// Read version (should be 1)
const version = view.getUint32(4, true);
console.log(`Version: ${version}`);

console.log(`Total size: ${cache.byteLength} bytes`);
```

## Complete Example

```javascript
#!/usr/bin/env bun
import { CachedBytecode } from "bun:internal-for-testing";
import { writeFileSync, readFileSync, existsSync } from "fs";

const modulePath = "/my-app/utils.js";
const cacheFile = "/tmp/utils.cache";

// Example module source
const moduleSource = `
export const API_URL = "https://api.example.com";
export const VERSION = "2.0.0";

export function fetchData(endpoint) {
  return fetch(\`\${API_URL}/\${endpoint}\`);
}

export default {
  init() {
    console.log("Initialized v" + VERSION);
  }
};
`;

console.log("ESM Bytecode Cache Demo\n");

// Step 1: Generate cache
console.log("1. Generating cache...");
const cache = CachedBytecode.generateForESMWithMetadata(
  modulePath,
  moduleSource
);

if (!cache) {
  console.error("Failed to generate cache");
  process.exit(1);
}

console.log(`   ✓ Generated ${cache.byteLength} bytes`);

// Step 2: Validate cache
console.log("\n2. Validating cache...");
const isValid = CachedBytecode.validateMetadata(cache);

if (!isValid) {
  console.error("   ✗ Cache validation failed");
  process.exit(1);
}

console.log("   ✓ Cache is valid");

// Step 3: Save cache
console.log("\n3. Saving cache...");
writeFileSync(cacheFile, cache);
console.log(`   ✓ Saved to ${cacheFile}`);

// Step 4: Load and re-validate
console.log("\n4. Loading and re-validating...");
const loadedCache = new Uint8Array(readFileSync(cacheFile));
const stillValid = CachedBytecode.validateMetadata(loadedCache);

if (!stillValid) {
  console.error("   ✗ Loaded cache is invalid");
  process.exit(1);
}

console.log("   ✓ Loaded cache is valid");

// Step 5: Inspect structure
console.log("\n5. Cache structure:");
const view = new DataView(
  loadedCache.buffer,
  loadedCache.byteOffset,
  loadedCache.byteLength
);

const magic = view.getUint32(0, true);
const version = view.getUint32(4, true);

console.log(`   Magic: 0x${magic.toString(16)} ("BMES")`);
console.log(`   Version: ${version}`);
console.log(`   Size: ${loadedCache.byteLength} bytes`);

console.log("\n✓ All operations successful!");
```

## Performance Testing

To measure performance improvements:

```javascript
import { CachedBytecode } from "bun:internal-for-testing";
import { performance } from "perf_hooks";

const source = `/* your module code */`;
const iterations = 100;

// Benchmark generation
let genTotal = 0;
for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  const cache = CachedBytecode.generateForESMWithMetadata("/test.js", source);
  genTotal += (performance.now() - start);
}
console.log(`Generation: ${(genTotal / iterations).toFixed(3)}ms avg`);

// Benchmark validation
const cache = CachedBytecode.generateForESMWithMetadata("/test.js", source);
let valTotal = 0;
for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  CachedBytecode.validateMetadata(cache);
  valTotal += (performance.now() - start);
}
console.log(`Validation: ${(valTotal / iterations).toFixed(3)}ms avg`);
console.log(`Speedup: ${(genTotal / valTotal).toFixed(1)}x`);
```

## Test Files

Several test files are included in the repository:

### test-cache-roundtrip.js
Basic round-trip test verifying that cache can be generated and validated:
```bash
bun test-cache-roundtrip.js
```

### test-manual-cache-usage.js
Performance benchmark with detailed output:
```bash
bun test-manual-cache-usage.js
```

Expected output:
```
ESM Bytecode Cache - Manual Performance Test

Test 1: Cache Generation
✅ Cache generated: 3810 bytes
⏱️  Generation time: 65.93ms

Test 2: Cache Validation
✅ Cache is valid
⏱️  Validation time: 0.02ms

Test 3: Performance Comparison
📊 Results (100 iterations):
   Cache generation: 9.579ms avg
   Cache validation: 0.001ms avg
   Speedup: 8329.2x faster
```

## Current Limitations

### Not Yet Implemented

1. **Automatic Caching**: ModuleLoader does not automatically generate or use caches
2. **Filesystem Storage**: No built-in cache directory (`~/.bun-cache/esm/`)
3. **CLI Flag**: No `--experimental-esm-bytecode` flag
4. **Cache Invalidation**: No automatic detection of file changes
5. **JSModuleRecord Reconstruction**: Cannot directly load from cache into module system

### Workarounds

For now, you can:
- Manually generate caches for modules
- Store caches in your own directory structure
- Use the validation API to check cache integrity
- Benchmark performance improvements manually

## Binary Format Details

The BMES (Bun Module ESM Serialization) v1 format:

```
Offset | Size | Description
-------|------|------------
0x00   | 4    | Magic: 0x424D4553 ("BMES")
0x04   | 4    | Version: 1
0x08   | 4    | Module request count
...    | var  | Module requests (specifier + attributes)
...    | 4    | Import entry count
...    | var  | Import entries (type, names)
...    | 4    | Export entry count
...    | var  | Export entries (type, names)
...    | 4    | Star export count
...    | var  | Star exports (module names)
...    | 4    | Bytecode size
...    | var  | Bytecode data
```

### String Encoding

Strings are encoded as:
```
[4 bytes: length] [length bytes: UTF-8 data]
```

### Import/Export Types

Import entry types:
- 0: Single
- 1: SingleTypeScript
- 2: Namespace

Export entry types:
- 0: Local
- 1: Indirect
- 2: Namespace

## Future Usage (When Phase 3 is Complete)

Once ModuleLoader integration is complete, usage will be automatic:

```bash
# Enable ESM bytecode caching
bun --experimental-esm-bytecode run app.js

# First run: generates caches
# Second run: uses caches (30-50% faster)
```

Cache location will be:
```
~/.bun-cache/esm/
  ├── <hash1>.cache
  ├── <hash2>.cache
  └── ...
```

## Troubleshooting

### Cache Generation Fails

```javascript
const cache = CachedBytecode.generateForESMWithMetadata("/test.js", source);
if (!cache) {
  // Possible causes:
  // 1. Invalid source code (syntax errors)
  // 2. Source URL starts with "file://" (remove it)
  // 3. Out of memory
}
```

### Cache Validation Fails

```javascript
if (!CachedBytecode.validateMetadata(cache)) {
  // Possible causes:
  // 1. Wrong magic number (corrupted file)
  // 2. Wrong version (incompatible format)
  // 3. Truncated file
}
```

### Assertion Errors

If you get:
```
ASSERTION FAILED: specifier should not already be a file URL
!sourceURL.startsWith("file://"_s)
```

Remove the `file://` prefix from the source URL:
```javascript
// ❌ Wrong
CachedBytecode.generateForESMWithMetadata("file:///path/to/module.js", source);

// ✅ Correct
CachedBytecode.generateForESMWithMetadata("/path/to/module.js", source);
```

## Contributing

To continue Phase 3 implementation:

1. See `INTEGRATION_PLAN.md` for detailed plans
2. Start with `fetchESMSourceCode()` in ModuleLoader.cpp
3. Add cache storage logic
4. Implement CLI flag
5. Add integration tests

## References

- `ESM_BYTECODE_CACHE.md` - Technical specification
- `PERFORMANCE_RESULTS.md` - Benchmark results
- `INTEGRATION_PLAN.md` - Phase 3 implementation plan
- `FINAL_STATUS.md` - Current status

---

**Last Updated**: 2025-12-04
**Branch**: `bun-build-esm`
**Status**: Phase 2 Complete (Manual Usage Available)
