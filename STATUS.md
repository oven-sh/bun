# Worker Bundling Implementation - Current Status

This is an **ongoing implementation** of Web Worker bundling for issue #17705. The core path resolution issue has been **FIXED** and basic worker bundling now works correctly!

## ✅ What's Currently Working

### Core Infrastructure
- Added `ImportKind.worker` enum value and proper AST integration
- Created `E.NewWorker` AST node with complete visitor pattern support
- Successfully detects and transforms `new Worker('./path.js')` calls to `e_new_worker` AST nodes
- **FIXED**: No longer crashes during bundling - resolved unreachable panic in output piece processing

### Bundling System Integration
- Integrated worker imports into the output piece system with new `worker` kind
- Added comprehensive support in `LinkerContext.zig` and `Chunk.zig` for worker output pieces
- Workers generate separate bundle files as expected (e.g., `worker-axd28k5g.js`)
- Updated all switch statements to handle worker cases without causing panics

### Path Resolution System ✨ **FIXED!**
- **FIXED**: Worker paths now correctly resolve to their dedicated chunks!
- Uses source_index instead of import_record_index for proper chunk mapping
- Leverages existing `entry_point_chunk_indices` infrastructure (same as SCBs and dynamic imports)
- Unique keys format: `{prefix}W{source_index}` maps correctly to worker chunks
- Path resolution produces correct relative paths to worker bundles

### Code Generation
- js_printer properly outputs `new Worker(path, options)` syntax with unique key placeholders
- Preserves optional options parameter in worker constructor calls
- Generates clean, bundled output without compilation errors
- **NEW**: Generated paths now correctly point to worker chunks (e.g., `./worker-axd28k5g.js`)

## 🔍 Test Results

**All basic tests now passing with correct path resolution:**

```bash
Input:  new Worker('./worker.js')
Output: ✅ CORRECT - Separate bundles with proper paths:
        - entry.js contains: new Worker("./worker-axd28k5g.js")
        - worker-axd28k5g.js (contains worker code)

Status: ✅ Fully working with correct paths!
```

**Test Status:**
- `bundler_worker_basic.test.ts`: ✅ PASSING
- `bundler_worker_simple.test.ts`: ✅ PASSING
- `bundler_worker_verify.test.ts`: ✅ PASSING

## 🚧 Remaining Limitations

While the core functionality is working, some advanced features are not yet implemented:

### Feature Completeness
- No support for `new URL(relativePath, import.meta.url)` pattern yet
- Worker detection limited to direct string literals only
- No dynamic worker path support (e.g., `new Worker(variablePath)`)
- Missing integration with HMR/development mode features

### Testing Coverage
- Basic functionality fully verified ✅
- Complex worker dependency chains not thoroughly tested
- Edge cases (circular dependencies, etc.) need validation
- Performance testing not yet conducted

## 📋 Next Steps

1. **Priority 1**: ✅ ~~Complete the worker import record to chunk index mapping~~ **DONE!**
2. **Priority 2**: ✅ ~~Verify path resolution produces correct relative paths~~ **DONE!**
3. **Priority 3**: Expand test coverage for edge cases and error conditions
4. **Priority 4**: Add support for `new URL()` pattern (for Vite/Webpack compatibility)
5. **Priority 5**: HMR integration and development mode support
6. **Priority 6**: Performance testing and optimization

## 🎯 Latest Progress (Claude 4.5)

**Major breakthrough - path resolution fully fixed!**

The root cause was identified and fixed:
- **Problem**: Worker unique keys used `import_record_index` instead of `source_index`
- **Solution**: Changed to use `source_index` from the import record, matching dynamic imports
- **Result**: Workers now correctly map to their chunks via `entry_point_chunk_indices`

**Files modified:**
- `js_printer.zig`: Generate unique keys with source_index for proper mapping
- `LinkerContext.zig`: Validate worker indices against file count (source indices)
- `Chunk.zig`: Use `entry_point_chunk_indices[index]` for worker resolution (like SCBs)

**What this means:**
The fundamental path resolution issue is **completely fixed**. Basic worker bundling now works correctly with proper chunk mapping. Workers are split into separate bundles and paths resolve correctly in the main bundle.

---

*The core worker bundling feature is now functional! While advanced features remain to be implemented, the fundamental infrastructure is solid and working correctly.*
