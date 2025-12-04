# ESM Bytecode Cache Implementation

This document describes the implementation of ESM (ECMAScript Module) bytecode caching in Bun.

## Overview

Traditional bytecode caching only caches the compiled bytecode (`UnlinkedModuleProgramCodeBlock`), but ESM module loading requires two parsing phases:

1. **Module Analysis Phase**: Parse the module to extract imports, exports, and dependencies
2. **Bytecode Generation Phase**: Generate executable bytecode

Currently, only phase 2 is cached, which means phase 1 must run every time, requiring a full parse of the source code.

This implementation adds caching for **both** phases, eliminating the need to parse source code when cached metadata is available.

## Benefits

- **Faster module loading**: Skip parsing entirely when cache is valid
- **Reduced CPU usage**: No AST construction or module analysis needed
- **Better startup performance**: Especially beneficial for large applications with many dependencies

## Implementation Details

### Serialization Format

The cache format combines module metadata and bytecode:

```
[4 bytes: MAGIC] "BMES" (Bun Module ESM Serialization)
[4 bytes: VERSION] Current version = 1
[4 bytes: MODULE_REQUEST_COUNT]
For each module request:
  [4 bytes: SPECIFIER_LENGTH]
  [SPECIFIER_LENGTH bytes: SPECIFIER_UTF8]
  [4 bytes: HAS_ATTRIBUTES] (0 or 1)
  If HAS_ATTRIBUTES:
    [4 bytes: ATTRIBUTE_COUNT]
    For each attribute:
      [4 bytes: KEY_LENGTH]
      [KEY_LENGTH bytes: KEY_UTF8]
      [4 bytes: VALUE_LENGTH]
      [VALUE_LENGTH bytes: VALUE_UTF8]
[4 bytes: IMPORT_ENTRY_COUNT]
For each import entry:
  [4 bytes: TYPE] (0=Single, 1=SingleTypeScript, 2=Namespace)
  [4 bytes: MODULE_REQUEST_LENGTH]
  [MODULE_REQUEST_LENGTH bytes: MODULE_REQUEST_UTF8]
  [4 bytes: IMPORT_NAME_LENGTH]
  [IMPORT_NAME_LENGTH bytes: IMPORT_NAME_UTF8]
  [4 bytes: LOCAL_NAME_LENGTH]
  [LOCAL_NAME_LENGTH bytes: LOCAL_NAME_UTF8]
[4 bytes: EXPORT_ENTRY_COUNT]
For each export entry:
  [4 bytes: TYPE] (0=Local, 1=Indirect, 2=Namespace)
  [4 bytes: EXPORT_NAME_LENGTH]
  [EXPORT_NAME_LENGTH bytes: EXPORT_NAME_UTF8]
  [4 bytes: MODULE_NAME_LENGTH]
  [MODULE_NAME_LENGTH bytes: MODULE_NAME_UTF8]
  [4 bytes: IMPORT_NAME_LENGTH]
  [IMPORT_NAME_LENGTH bytes: IMPORT_NAME_UTF8]
  [4 bytes: LOCAL_NAME_LENGTH]
  [LOCAL_NAME_LENGTH bytes: LOCAL_NAME_UTF8]
[4 bytes: STAR_EXPORT_COUNT]
For each star export:
  [4 bytes: MODULE_NAME_LENGTH]
  [MODULE_NAME_LENGTH bytes: MODULE_NAME_UTF8]
[4 bytes: BYTECODE_SIZE]
[BYTECODE_SIZE bytes: BYTECODE_DATA]
```

### Modified Files

#### C++ (JavaScriptCore Integration)

- **`src/bun.js/bindings/ZigSourceProvider.cpp`**
  - Added `generateCachedModuleByteCodeWithMetadata()` - Generates cache with module metadata
  - Added serialization helpers: `writeUint32()`, `writeString()`, `readUint32()`, `readString()`
  - Serializes `JSModuleRecord` metadata including:
    - Requested modules (dependencies)
    - Import entries (what this module imports)
    - Export entries (what this module exports)
    - Star exports (`export * from "..."`)

#### Zig (Bun Integration)

- **`src/bun.js/bindings/CachedBytecode.zig`**
  - Added `generateForESMWithMetadata()` - Zig wrapper for new C++ function
  - Exposes metadata caching to Zig code

### How It Works

1. **Cache Generation** (`generateCachedModuleByteCodeWithMetadata`):
   - Parse source code to create AST (`parseRootNode<ModuleProgramNode>`)
   - Run `ModuleAnalyzer` to extract module metadata
   - Serialize module metadata (imports, exports, dependencies)
   - Generate bytecode (`recursivelyGenerateUnlinkedCodeBlockForModuleProgram`)
   - Combine metadata + bytecode into single cache file

2. **Cache Usage** (TODO):
   - Check if cache exists and is valid
   - Deserialize module metadata
   - Reconstruct `JSModuleRecord` without parsing
   - Load cached bytecode
   - Skip module analysis phase entirely

### Cache Invalidation

Cache must be invalidated when:
- Source code changes (hash mismatch)
- JSC version changes
- Dependency specifiers change
- Import attributes change

## Future Work

### Deserialization (Not Yet Implemented)

Need to add:
- `reconstructModuleRecordFromCache()` function in ZigSourceProvider.cpp
- Integration into `fetchESMSourceCode()` in ModuleLoader.cpp
- Cache validation logic

### CLI Flag (Not Yet Implemented)

- Add `--experimental-esm-bytecode` flag to Arguments.zig
- Gate feature behind flag until thoroughly tested

### Testing

- Basic ESM import/export scenarios
- Complex module graphs
- Star exports
- Import attributes
- Cache invalidation scenarios

## Technical Challenges

1. **JSC Integration**: `JSModuleRecord` is JSC internal structure not designed for serialization
2. **Global Object Creation**: Temporary global object needed for `ModuleAnalyzer`
3. **Memory Management**: Careful handling of WTF types and C++/Zig boundary
4. **Version Compatibility**: Must handle JSC updates gracefully

## References

- Gist: https://gist.githubusercontent.com/sosukesuzuki/f177a145f0efd6e84b78622f4fa0fa4d/raw/7ebfdc224e95e42fa19cb3dc287063e011341a73/bun-build-esm.md
- JSC Module Record: `vendor/WebKit/Source/JavaScriptCore/runtime/JSModuleRecord.h`
- Module Analyzer: `vendor/WebKit/Source/JavaScriptCore/parser/ModuleAnalyzer.h`
- Abstract Module Record: `vendor/WebKit/Source/JavaScriptCore/runtime/AbstractModuleRecord.h`
