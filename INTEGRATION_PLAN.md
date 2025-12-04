# ESM Bytecode Cache - Integration Plan

## Current Status (Phase 2 Complete)

✅ **Serialization**: Complete
- `generateCachedModuleByteCodeWithMetadata()` - Extracts and serializes module metadata + bytecode
- Binary format: BMES v1
- Includes: requested modules, imports, exports, star exports, bytecode

✅ **Deserialization**: Complete
- `deserializeCachedModuleMetadata()` - Restores metadata from cache
- `validateCachedModuleMetadata()` - Validates cache integrity
- Returns `DeserializedModuleMetadata` structure

✅ **Testing**: Complete
- Round-trip test passes (2320 bytes cache generated)
- Format validation works correctly

## Phase 3: ModuleLoader Integration

### Challenge: JSModuleRecord Reconstruction

JSModuleRecord has a private constructor and is normally created by `ModuleAnalyzer::analyze()`.

**Options considered**:
1. ❌ Direct JSModuleRecord construction - Constructor is private
2. ❌ Using AbstractModuleRecord methods - Too low-level, requires internal JSC knowledge
3. ✅ **Recommended: ModuleLoader-level integration**

### Recommended Approach

Instead of reconstructing JSModuleRecord, integrate at the ModuleLoader level where we can:
1. Detect cached module availability
2. Load bytecode directly
3. Skip parse + analysis phases
4. Let JSC handle the rest naturally

## Implementation Strategy

### Step 1: Add Cache Storage Layer

**File**: New file `src/bun.js/bindings/ModuleBytecodeCache.cpp/.h`

```cpp
class ModuleBytecodeCache {
public:
    // Check if cache exists for a module
    static bool hasCache(const WTF::String& sourceURL);

    // Save cache for a module
    static void saveCache(const WTF::String& sourceURL,
                         const uint8_t* data, size_t size);

    // Load cache for a module
    static RefPtr<CachedBytecode> loadCache(const WTF::String& sourceURL);

private:
    // Cache directory: ~/.bun-cache/esm/
    // Cache key: SHA256(sourceURL + file content hash)
};
```

### Step 2: Integrate into ModuleLoader

**File**: `src/bun.js/bindings/ModuleLoader.cpp`

Modify `fetchESMSourceCode()`:

```cpp
// Before parsing
if (shouldUseBytecodeCache()) {
    auto cached = ModuleBytecodeCache::loadCache(sourceURL);
    if (cached && validateCachedModuleMetadata(cached->data(), cached->size())) {
        // Use cached bytecode directly
        // Skip parse + analysis
        return createModuleFromCache(cached);
    }
}

// Existing parse + analysis code
// ...

// After successful analysis
if (shouldUseBytecodeCache()) {
    // Generate and save cache
    generateAndSaveCache(sourceURL, sourceCode);
}
```

### Step 3: Add CLI Flag

**File**: `src/cli.zig`

```zig
var enable_esm_bytecode_cache: bool = false;

// Add flag parsing
if (std.mem.eql(u8, arg, "--experimental-esm-bytecode")) {
    enable_esm_bytecode_cache = true;
}
```

### Step 4: Zig Integration

**File**: `src/bun.js/ModuleLoader.zig`

```zig
pub const enable_esm_bytecode_cache = @import("cli.zig").enable_esm_bytecode_cache;

pub fn shouldUseBytecodeCache() bool {
    return enable_esm_bytecode_cache;
}
```

## Testing Plan

### Unit Tests
- Cache storage/retrieval
- Cache invalidation (file changes)
- Cache corruption handling

### Integration Tests
- First load (no cache) - generates cache
- Second load (cache hit) - uses cache
- File modification - invalidates cache
- Performance comparison (with/without cache)

### Performance Benchmarks
```bash
# Before
bun run index.js  # 115ms

# After (cache hit)
bun --experimental-esm-bytecode run index.js  # 60-70ms (30-50% faster)
```

## Alternative: Bytecode-Only Approach (Simpler)

If full metadata caching proves complex, we can:
1. Only cache bytecode (skip metadata caching)
2. Still parse source (fast) but skip bytecode generation
3. ~20-30% improvement instead of 30-50%

This requires minimal changes to existing code.

## Timeline

- ✅ Phase 1 (Serialization): Complete
- ✅ Phase 2 (Deserialization): Complete
- ⏳ Phase 3 (Integration): 1-2 weeks
  - Week 1: Cache storage + ModuleLoader changes
  - Week 2: Testing + benchmarking

## Documentation Needs

1. User documentation
   - How to enable (`--experimental-esm-bytecode`)
   - Performance expectations
   - Cache location and management

2. Developer documentation
   - Binary format specification
   - Cache invalidation strategy
   - Debugging cached modules

## Security Considerations

1. **Cache Integrity**: Magic number + version check
2. **Content Verification**: Include source hash in cache key
3. **Cache Poisoning**: Only cache files owned by current user
4. **Denial of Service**: Limit cache size (e.g., 100MB max)

## Future Enhancements

1. **Cross-session cache**: Persist cache between Bun runs
2. **Shared cache**: Share cache between projects (content-addressed)
3. **Precompilation**: `bun cache compile` to pregenerate caches
4. **Cache analytics**: Report cache hit/miss rates

---

**Last Updated**: 2025-12-04
**Author**: Claude Code
**Status**: Phase 2 complete, Phase 3 planning
