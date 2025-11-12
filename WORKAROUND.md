# Workaround for JSArray Segmentation Fault

## 🚨 Issue

If you're experiencing segmentation faults (crashes) when creating large arrays in Bun, this is a known issue related to garbage collection and memory allocation. This document provides temporary workarounds until the fix is released.

## ⚠️ Symptoms

- Bun crashes with "Segmentation fault" or "SIGSEGV"
- Crashes occur when creating large arrays: `Array(1000000).fill(1)`
- More likely to occur on macOS
- More common in standalone builds

## 🔧 Workarounds

### Workaround 1: Chunk Large Arrays

Instead of creating one large array, break it into smaller chunks:

```javascript
// ❌ DON'T: This may crash
const largeArray = Array(1000000).fill(1);

// ✅ DO: Create in chunks
function createLargeArray(size, chunkSize = 100000) {
    const result = [];
    for (let i = 0; i < size; i += chunkSize) {
        const chunk = Array(Math.min(chunkSize, size - i)).fill(1);
        result.push(...chunk);
    }
    return result;
}

const largeArray = createLargeArray(1000000);
```

### Workaround 2: Manual GC Control

Force garbage collection at safe points to avoid race conditions:

```javascript
const arrays = [];
const arraySize = 1000000;

for (let i = 0; i < 100; i++) {
    arrays.push(Array(arraySize).fill(1));
    
    // Force GC every 10 iterations
    if (i % 10 === 0 && bun.gc) {
        bun.gc(true);
    }
}
```

### Workaround 3: Serialize Allocations

Avoid concurrent array allocations:

```javascript
// ❌ DON'T: Concurrent allocations
const promises = Array.from({ length: 10 }, () => 
    Promise.resolve().then(() => Array(1000000).fill(1))
);
await Promise.all(promises);

// ✅ DO: Serialize allocations
const arrays = [];
for (let i = 0; i < 10; i++) {
    arrays.push(Array(1000000).fill(1));
    // Small delay to avoid race conditions
    await new Promise(resolve => setTimeout(resolve, 1));
}
```

### Workaround 4: Use TypedArrays for Large Data

For numeric data, consider using TypedArrays which have different allocation paths:

```javascript
// Instead of regular array
const largeArray = Array(1000000).fill(0);

// Use TypedArray
const largeArray = new Uint8Array(1000000);
// or
const largeArray = new Float64Array(1000000);
```

### Workaround 5: Reduce Array Sizes

If possible, redesign to use smaller arrays:

```javascript
// Instead of one huge array
const data = Array(10000000).fill(0);

// Use multiple smaller arrays
const chunks = [];
for (let i = 0; i < 10; i++) {
    chunks.push(Array(1000000).fill(0));
}
```

## 🔍 Diagnostic Mode

Enable diagnostic logging to help identify the issue:

```bash
# Enable GC debugging
BUN_DEBUG_GC=1 bun run your-script.js

# Enable verbose logging
BUN_DEBUG=1 bun run your-script.js
```

## 📊 Monitoring

Monitor memory usage to identify problematic patterns:

```javascript
// Add memory monitoring
function logMemory() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
        const mem = process.memoryUsage();
        console.log(`Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
    }
}

// Log before/after large allocations
logMemory();
const largeArray = Array(1000000).fill(1);
logMemory();
```

## 🆙 Upgrade to v1.3.2+

If you're on Bun v1.3.1 or earlier, **upgrade to v1.3.2 or later** as the issue may be fixed:

```bash
# Upgrade Bun
bun upgrade

# Verify version
bun --version
```

## 🐛 Reporting Issues

If you encounter this issue:

1. **Check your Bun version**: `bun --version`
2. **Note your platform**: macOS, Linux, or Windows
3. **Describe the crash**: When does it occur? What were you doing?
4. **Include reproduction steps**: Minimal code that reproduces the issue
5. **Check for duplicates**: Search existing issues (#24357, #24194, #24509)

## 📝 Example: Safe Large Array Creation

Here's a complete example that safely creates large arrays:

```javascript
/**
 * Safely creates a large array by chunking and managing GC
 */
function createLargeArraySafely(size, value = 0, options = {}) {
    const {
        chunkSize = 100000,
        enableGC = true,
        gcInterval = 10
    } = options;
    
    const result = [];
    const numChunks = Math.ceil(size / chunkSize);
    
    for (let i = 0; i < numChunks; i++) {
        const currentChunkSize = Math.min(chunkSize, size - result.length);
        const chunk = Array(currentChunkSize).fill(value);
        result.push(...chunk);
        
        // Force GC periodically if enabled
        if (enableGC && bun.gc && i % gcInterval === 0 && i > 0) {
            bun.gc(true);
        }
    }
    
    return result;
}

// Usage
const largeArray = createLargeArraySafely(1000000, 1, {
    chunkSize: 50000,
    enableGC: true,
    gcInterval: 5
});
```

## 🔗 Related Resources

- [Issue Analysis](./SEGFAULT_ANALYSIS.md)
- [Regression Test](./test/regression/segfault-jsarray-allocator.test.ts)
- [Bun GitHub Issues](https://github.com/oven-sh/bun/issues)

## ⏰ Timeline

- **v1.3.1**: Issue reported
- **v1.3.2**: Potential fix (verify if issue persists)
- **Future**: Permanent fix in upstream WebKit

---

**Note**: These workarounds are temporary. The root cause is in JavaScriptCore's allocator and should be fixed in a future Bun/WebKit update.

