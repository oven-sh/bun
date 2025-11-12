# Segmentation Fault Analysis: JSArray Allocation with Invalid MarkedBlock

## 🎯 Issue Summary

**Labels**: `crash`, `macOS`, `runtime`, `needs triage`  
**Possible Duplicates**: #24357, #24194, #24509  
**Affected Versions**: Bun v1.3.1 (potentially fixed in v1.3.2)  
**Platform**: macOS (likely affects standalone builds)

## 🔍 Root Cause Analysis

### Problem Description

The segmentation fault occurs during array allocation via `JSArray::tryCreate`, where the allocator attempts to use a **freed or invalid MarkedBlock**. This suggests a race condition or synchronization issue between:

1. **Garbage Collection (GC) Sweep Phase**: `MarkedBlock::Handle::sweep()` freeing memory
2. **LocalAllocator**: Attempting to allocate memory from blocks that have been freed

### Technical Details

#### Likely Failure Points

1. **MarkedBlock Lifecycle Issue**
   - A `MarkedBlock` is freed during GC sweep while still referenced by a `LocalAllocator`
   - The allocator attempts to allocate from a block that has been deallocated
   - This results in accessing invalid memory → segmentation fault

2. **Race Condition Scenarios**
   - **Scenario A**: GC sweep thread frees a block while allocator thread is using it
   - **Scenario B**: Block is marked as free but pointer is still cached in allocator
   - **Scenario C**: Uninitialized or misaligned block pointer in standalone mode

3. **Standalone Build Specifics**
   - The issue may be specific to standalone executable builds
   - Embedded JSC in Bun CLI might have different memory layout
   - Could be related to static initialization order

### Code Flow (Hypothetical)

```
Thread 1 (Allocator):              Thread 2 (GC Sweep):
─────────────────────               ────────────────────
LocalAllocator::tryAllocateIn()     MarkedBlock::Handle::sweep()
  ↓                                    ↓
  if (!m_block) return nullptr;       MarkedBlock freed
  ↓                                    ↓
  m_block->allocate()  ←───────────  [SEGFAULT: block is freed]
```

## 🔬 Diagnostic Evidence

### Stack Trace Pattern (Expected)

```
Thread 0 Crashed:: Dispatch queue: com.apple.main-thread
0   JavaScriptCore                 0x... JSArray::tryCreate(...)
1   JavaScriptCore                 0x... LocalAllocator::tryAllocateIn(...)
2   JavaScriptCore                 0x... MarkedBlock::Handle::allocate(...)
3   JavaScriptCore                 0x... [Invalid memory access]
```

### Memory State Indicators

- **Invalid pointer**: `m_block` points to freed memory
- **Double free**: Block freed multiple times
- **Use-after-free**: Block accessed after deallocation

## 🛠️ Proposed Fixes

### Fix 1: Add Validity Checks in LocalAllocator

**Location**: JavaScriptCore `LocalAllocator::tryAllocateIn()` (in WebKit source)

```cpp
void* LocalAllocator::tryAllocateIn(MarkedBlock::Handle* block)
{
    // Add validity check before using block
    if (!block || !block->isValid()) {
        return nullptr;
    }
    
    // Ensure block hasn't been swept
    if (block->isFreeListed() || block->isEmpty()) {
        return nullptr;
    }
    
    // Existing allocation logic...
}
```

### Fix 2: Synchronize GC Sweep with Allocator

**Location**: JavaScriptCore `MarkedBlock::Handle::sweep()` (in WebKit source)

```cpp
void MarkedBlock::Handle::sweep()
{
    // Before freeing, ensure no active allocators reference this block
    if (hasActiveAllocators()) {
        // Defer sweep or mark for later collection
        markForDeferredSweep();
        return;
    }
    
    // Safe to sweep now
    // Existing sweep logic...
}
```

### Fix 3: Add Block Validation in JSArray::tryCreate

**Location**: JavaScriptCore `JSArray::tryCreate()` (in WebKit source)

```cpp
JSArray* JSArray::tryCreate(VM& vm, Structure* structure, unsigned length)
{
    // Validate allocator state before allocation
    if (!vm.heap.isValidAllocatorState()) {
        return nullptr;
    }
    
    // Existing allocation logic with null checks...
}
```

### Fix 4: Improve Diagnostic Logging

**Location**: Bun's bindings or JSC integration layer

Add logging to detect invalid block access:

```cpp
// In Bun's JSC integration
if (BUN_DEBUG_GC) {
    if (!block || !isValidPointer(block)) {
        fprintf(stderr, "[GC DEBUG] Invalid block pointer: %p\n", block);
        dumpStackTrace();
    }
}
```

## 🔄 Version Comparison: v1.3.1 vs v1.3.2

### Check WebKit Version Updates

The fix may be in the WebKit version used by Bun:

1. **Check WebKit commit**: Compare WebKit versions between v1.3.1 and v1.3.2
2. **Look for GC/allocator fixes**: Search WebKit changelog for:
   - "MarkedBlock" fixes
   - "LocalAllocator" improvements
   - "GC sweep" synchronization
   - "Use-after-free" fixes

### Git Commands to Check

```bash
# Check WebKit version in v1.3.1
git checkout v1.3.1
grep -r "WEBKIT_VERSION" cmake/

# Check WebKit version in v1.3.2
git checkout v1.3.2
grep -r "WEBKIT_VERSION" cmake/

# Compare WebKit commits
# If WebKit is a submodule, check:
git submodule status
```

## 🧪 Reproduction Steps

### Minimal Reproduction

```bash
# Create test file
cat > crash.js << 'EOF'
// Force large array allocation that may trigger GC during allocation
const arrays = [];
for (let i = 0; i < 1000; i++) {
    arrays.push(Array(1000000).fill(1));
    if (i % 100 === 0) {
        console.log(`Allocated ${i} arrays`);
    }
}
EOF

# Run with Bun
bun run crash.js
```

### Stress Test

```bash
# More aggressive test
cat > stress-crash.js << 'EOF'
// Concurrent allocations to trigger race conditions
const promises = [];
for (let i = 0; i < 10; i++) {
    promises.push(
        Promise.resolve().then(() => {
            const arr = Array(1000000).fill(Math.random());
            return arr.length;
        })
    );
}
Promise.all(promises).then(() => console.log('Done'));
EOF

bun run stress-crash.js
```

## 🚨 Workaround for Users

### Temporary Workaround

Until the fix is available, users can:

1. **Reduce array sizes**: Break large arrays into smaller chunks
2. **Manual GC control**: Use `bun.gc(true)` to force GC at safe points
3. **Avoid concurrent allocations**: Serialize array creation
4. **Upgrade to v1.3.2**: If fixed, upgrade immediately

### Example Workaround Code

```javascript
// Instead of:
const largeArray = Array(1000000).fill(1);

// Use:
function createLargeArray(size, chunkSize = 100000) {
    const result = [];
    for (let i = 0; i < size; i += chunkSize) {
        const chunk = Array(Math.min(chunkSize, size - i)).fill(1);
        result.push(...chunk);
        // Allow GC between chunks
        if (i % (chunkSize * 10) === 0) {
            bun.gc(true);
        }
    }
    return result;
}
```

## 📊 Diagnostic Improvements

### Enhanced Logging

Add environment variable to enable GC diagnostics:

```bash
BUN_DEBUG_GC=1 bun run crash.js
```

This should log:
- Block allocation/deallocation events
- GC sweep operations
- Allocator state transitions
- Invalid pointer accesses

### Crash Reporting

Improve crash handler to capture:
- Allocator state at crash time
- Active MarkedBlocks
- GC phase information
- Thread synchronization state

## 🔗 Related Issues

- #24357: Similar segmentation fault
- #24194: GC-related crash
- #24509: Array allocation issue

## 📝 Next Steps

1. ✅ Create reproduction test case
2. ✅ Document root cause analysis
3. ⏳ Verify if fixed in v1.3.2
4. ⏳ Propose patch to WebKit (if not fixed)
5. ⏳ Add diagnostic logging
6. ⏳ Create workaround documentation

## 🎓 References

- [JavaScriptCore Heap Documentation](https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/)
- [WebKit MarkedBlock Implementation](https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/heap)
- [Bun WebKit Fork](https://github.com/oven-sh/WebKit)

