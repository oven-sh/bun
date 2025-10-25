# SourceProvider Refactoring - Implementation Status

## Overview
Refactoring `ResolvedSource` and `ZigSourceProvider` to eliminate complexity, reduce memory usage, and clarify ownership.

**Goal**: Reduce from 12-field struct to focused 5-field types with type-safe unions.

## Phase 1: Infrastructure ✅ COMPLETE

### Completed Work
All new infrastructure files have been created and the build passes with existing tests:

1. **Created New Zig Types**:
   - `src/bun.js/bindings/TranspiledSource.zig` - Minimal 5-field POD struct for transpiled code
   - `src/bun.js/bindings/SpecialModule.zig` - Handle special cases (exports objects, custom extensions)
   - `src/bun.js/bindings/ModuleResult.zig` - Tagged union return type

2. **Created New C++ SourceProvider**:
   - `src/bun.js/bindings/BunSourceProvider.h` - Simplified SourceProvider header
   - `src/bun.js/bindings/BunSourceProvider.cpp` - Implementation with `Bun__createSourceProvider` C bridge

3. **Verification**:
   - Build succeeds: `bun bd` ✅
   - Tests pass: `bun bd test test/regression/issue23966.test.ts` ✅
   - All new code coexists with old code during migration

### Key Implementation Details

**TranspiledSource** (5 fields vs 12 in ResolvedSource):
```zig
pub const TranspiledSource = extern struct {
    source_code: bun.String,
    source_url: bun.String,
    bytecode_cache: ?[*]u8,
    bytecode_cache_len: usize,
    flags: Flags,
};
```

**ModuleResult** (Tagged union for type safety):
```zig
pub const ModuleResult = extern struct {
    tag: Tag,  // transpiled | special | builtin
    value: extern union {
        transpiled: TranspiledSource,
        special: SpecialModule,
        builtin_id: u32,
    },
};
```

**BunSourceProvider C Bridge**:
```cpp
extern "C" JSC::SourceProvider* Bun__createSourceProvider(
    Zig::GlobalObject* globalObject,
    const TranspiledSource* source
)
```

## Phase 2: Update Zig Side - 🚧 TODO

### Functions to Modify

Based on codebase exploration, the following functions need updates:

#### 1. `transpileSourceCode()` - `/workspace/bun/src/bun.js/ModuleLoader.zig:820-1539`

**Current signature**:
```zig
pub fn transpileSourceCode(
    jsc_vm: *VirtualMachine,
    specifier: string,
    referrer: string,
    input_specifier: String,
    path: Fs.Path,
    loader: options.Loader,
    module_type: options.ModuleType,
    log: *logger.Log,
    virtual_source: ?*const logger.Source,
    promise_ptr: ?*?*jsc.JSInternalPromise,
    source_code_printer: *js_printer.BufferPrinter,
    globalObject: ?*JSGlobalObject,
    comptime flags: FetchFlags,
) !ResolvedSource  // ← Change to !ModuleResult
```

**Changes needed**:
- Change return type from `!ResolvedSource` to `!ModuleResult`
- Update all return statements to use ModuleResult tagged unions:
  - Normal transpilation → `ModuleResult{ .tag = .transpiled, .value = .{ .transpiled = TranspiledSource{...} } }`
  - JSON/TOML/YAML → `ModuleResult{ .tag = .special, .value = .{ .special = SpecialModule{...} } }`
  - HTML/assets → `ModuleResult{ .tag = .special, .value = .{ .special = SpecialModule{...} } }`

**Key return paths to update** (based on loader type):
- Lines 1076-1083: JSON files → `.special` with `.exports_object`
- Lines 1099-1117: JSONC/TOML/YAML → `.special` with `.exports_object`
- Lines 1288-1304: Normal transpilation → `.transpiled`
- Lines 1390-1430: SQLite → `.transpiled` (generated code)
- Lines 1432-1455: HTML → `.special` with `.export_default_object`
- Lines 1457-1537: Static assets → `.special` with `.export_default_object`

#### 2. `fetchBuiltinModule()` - Location TBD

**Changes needed**:
- Return `ModuleResult{ .tag = .builtin, .value = .{ .builtin_id = @intFromEnum(hardcoded) } }`
- Instead of returning full module source, just return the builtin ID
- C++ will look up the module in InternalModuleRegistry

#### 3. `TranspilerJob` - `/workspace/bun/src/bun.js/ModuleLoader.zig:2215-2605`

**Current structure**:
```zig
pub const TranspilerJob = struct {
    // ...
    resolved_source: ResolvedSource = ResolvedSource{},  // ← Change to ModuleResult
    // ...
};
```

**Changes needed in `run()` (worker thread - line 2312)**:
- Change `this.resolved_source` type from `ResolvedSource` to `ModuleResult`
- Update assignments (lines 2598-2603) to create `ModuleResult.transpiled`:
  ```zig
  this.resolved_source = ModuleResult{
      .tag = .transpiled,
      .value = .{ .transpiled = TranspiledSource{
          .source_code = source_code,
          .source_url = bun.String.empty,  // Set on main thread
          .flags = .{
              .is_commonjs = parse_result.ast.has_commonjs_export_names,
          },
      }},
  };
  ```

**Changes needed in `runFromJSThread()` (main thread - line 2267)**:
- Update to pass `ModuleResult*` instead of `ResolvedSource*`
- Set source_url on main thread if needed

#### 4. `AsyncModule` - `/workspace/bun/src/bun.js/ModuleLoader.zig:69+`

**Functions to update**:

**`resumeLoadingModule()` - Returns transpilation result**:
- Change return type from `!ResolvedSource` to `!ModuleResult`
- Update return statement to create `ModuleResult.transpiled`

**`fulfill()` - Accepts result and fulfills promise**:
- Change signature from accepting `ResolvedSource*` to `ModuleResult*`
- Pass to C++ `Bun__onFulfillAsyncModule` with new type

### Call Sites to Update

All callers of these functions need updates:
- Search for `transpileSourceCode` calls
- Search for `AsyncModule.fulfill` calls
- Search for `TranspilerJob` usage

## Phase 3: Update C++ Side - 🚧 TODO

### Functions to Modify

#### 1. `Bun__onFulfillAsyncModule` - `/workspace/bun/src/bun.js/bindings/ModuleLoader.cpp`

**Current signature**:
```cpp
extern "C" void Bun__onFulfillAsyncModule(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedPromiseValue,
    ErrorableResolvedSource* result,  // ← Change to ModuleResult*
    BunString* specifier,
    BunString* referrer)
```

**Changes needed**:
```cpp
switch (result->tag) {
case ModuleResult::Tag::transpiled: {
    auto* provider = Bun__createSourceProvider(globalObject, &result->value.transpiled);
    // Handle CommonJS vs ESM...
    break;
}
case ModuleResult::Tag::special: {
    // Should not reach AsyncModule path (synchronous)
    throwTypeError(...);
    break;
}
case ModuleResult::Tag::builtin: {
    // Should not reach AsyncModule path
    throwTypeError(...);
    break;
}
}
```

#### 2. `fetchESMSourceCode` - `/workspace/bun/src/bun.js/bindings/ModuleLoader.cpp`

**Changes needed**:
```cpp
template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierJS,
    ModuleResult* result,  // ← Changed type
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    switch (result->tag) {
    case ModuleResult::Tag::transpiled:
        // Use Bun__createSourceProvider
        break;
    case ModuleResult::Tag::special:
        // Handle exports_object, export_default_object, custom_extension
        break;
    case ModuleResult::Tag::builtin:
        // Return builtin module from InternalModuleRegistry
        break;
    }
}
```

#### 3. `fetchCommonJSModule` - Similar switch-based handling

#### 4. `Bun__transpileFile` - Update to return `ModuleResult*`

All the wrapper functions that call into Zig need their return types updated.

## Phase 4: Cleanup - 🚧 TODO

### Files to Remove/Modify

1. **Delete**:
   - Most of `src/bun.js/bindings/ZigSourceProvider.cpp` (keep only helper functions like `toSourceOrigin`)
   - `ResolvedSourceCodeHolder` class from ModuleLoader.cpp

2. **Update**:
   - `src/bun.js/bindings/ResolvedSource.zig` → Remove or mark deprecated
   - `src/bun.js/bindings/ZigSourceProvider.h` → Slim down or remove
   - Remove all references to old types throughout codebase

3. **Fields to remove from structs**:
   - `allocator` - Not needed, ownership is clear
   - `source_code_needs_deref` - SourceProvider handles it
   - `cjs_custom_extension_index` - Moved to SpecialModule
   - `jsvalue_for_export` - Moved to SpecialModule

## Phase 5: Testing & Verification - 🚧 TODO

### Test Areas

1. **Normal module loading**: `bun bd test test/js/bun/http/serve.test.ts`
2. **CommonJS**: `bun bd test test/js/node/fs.test.ts`
3. **Module resolution**: `bun bd test test/js/bun/resolve/`
4. **Plugins**: `bun bd test test/js/bun/plugin/`
5. **Bytecode**: `bun bd test test/bundler/bundler_compile.test.ts`
6. **Coverage**: `bun bd test test/js/bun/test/coverage.test.ts`
7. **Full test suite**: `bun bd test`

### Performance Checks

- Benchmark before/after with `@babel/standalone` load time
- Memory usage analysis
- Profile hot paths

### Memory Safety

- Run with ASAN/valgrind
- Check ref-counts carefully
- Test long-running processes

## Implementation Notes

### Key Insights from Codebase Exploration

1. **transpileSourceCode is 720 lines** (line 820-1539 in ModuleLoader.zig)
   - Main switch on `loader` type with 8+ different code paths
   - Returns different tags based on file type (JSON, TOML, HTML, etc.)

2. **TranspilerJob runs on worker threads**
   - `run()` executes on worker, stores result in `resolved_source` field
   - `runFromJSThread()` executes on main thread, calls `AsyncModule.fulfill()`
   - Uses object pooling for performance

3. **AsyncModule handles package downloads**
   - Waits for package manager to download dependencies
   - Then calls `resumeLoadingModule()` to finish transpilation
   - Finally calls `fulfill()` to resolve the JS promise

### Migration Strategy

The plan explicitly calls for **backward compatibility during migration**:
- Old code (ResolvedSource) and new code (ModuleResult) coexist
- Phase 1 creates new infrastructure ✅ DONE
- Phases 2-3 migrate to use new types
- Phase 4 removes old code once everything is migrated

This allows for incremental testing and reduces risk.

## Next Steps

1. **Phase 2**: Update Zig-side functions to return/use ModuleResult
2. **Phase 3**: Update C++-side functions to handle ModuleResult
3. **Phase 4**: Remove old ResolvedSource code
4. **Phase 5**: Comprehensive testing

## Git Branch

- Branch: `claude/refactor-source-provider`
- Pushed to: `origin/claude/refactor-source-provider`
- Current status: Phase 1 complete, ready for Phase 2

## References

- Original plan: `/tmp/PLAN.md`
- Main implementation file: `src/bun.js/ModuleLoader.zig` (2600+ lines)
- C++ module loader: `src/bun.js/bindings/ModuleLoader.cpp`
