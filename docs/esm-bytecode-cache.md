# ESM Bytecode Cache Architecture

## Overview

ESM Bytecode Cache is an experimental feature that enables bytecode caching for ES Modules in Bun's bundler. This allows compiled executables to skip the JavaScript parsing phase during module loading, improving startup performance for large applications.

## Architecture

### Binary Format: BMES v3

The ESM bytecode cache uses a custom binary format called BMES (Bun Module ES) version 3. This format stores both the bytecode and module metadata required to reconstruct a `JSModuleRecord` without parsing.

```
┌─────────────────────────────────────────┐
│              BMES Header                │
├─────────────────────────────────────────┤
│  Magic Number: "SEMB" (4 bytes)         │
│  Version: 3 (4 bytes)                   │
│  Bytecode Offset (4 bytes)              │
│  Bytecode Size (4 bytes)                │
├─────────────────────────────────────────┤
│          Module Metadata                │
├─────────────────────────────────────────┤
│  Requested Modules (dependencies)       │
│  Import Entries                         │
│  Export Entries                         │
│  Star Export Entries                    │
│  Declared Variables (var)               │
│  Lexical Variables (let/const)          │
│  Code Features flags                    │
├─────────────────────────────────────────┤
│            JSC Bytecode                 │
│  (WebKit JavaScriptCore format)         │
└─────────────────────────────────────────┘
```

### Module Loading Flow

#### Without Bytecode Cache (Traditional)

```
Source Code → Parse → ModuleAnalyzer → JSModuleRecord → Link → Evaluate
                ↓
           AST Generation
           Import/Export Analysis
           Variable Declaration Extraction
```

#### With Bytecode Cache

```
BMES File → Deserialize Metadata → JSModuleRecord::create() → Link → Evaluate
                    ↓
              Skip Parsing!
              Skip AST Generation!
              Skip Module Analysis!
```

### Implementation Components

#### 1. Metadata Serialization (`src/bun.js/bindings/ZigSourceProvider.cpp`)

During build time, module metadata is serialized into the BMES format:

```cpp
struct CachedModuleMetadata {
    Vector<ModuleRequest> requestedModules;  // import specifiers
    Vector<ImportEntry> importEntries;       // import bindings
    Vector<ExportEntry> exportEntries;       // export bindings
    Vector<WTF::String> starExportEntries;   // export * from
    Vector<VariableEntry> declaredVariables; // var declarations
    Vector<VariableEntry> lexicalVariables;  // let/const declarations
    uint32_t codeFeatures;                   // feature flags
};
```

#### 2. JSC Integration (`vendor/WebKit/Source/JavaScriptCore/`)

New virtual methods added to `SourceProvider`:

```cpp
// SourceProvider.h
virtual bool hasCachedModuleMetadata() const { return false; }
virtual JSModuleRecord* createModuleRecordFromCache(
    JSGlobalObject*, const Identifier&) { return nullptr; }
```

Cache check in module loader (`JSModuleLoader.cpp`):

```cpp
// Check if we can skip parsing by using cached module metadata
if (sourceCode.provider()->hasCachedModuleMetadata()) {
    JSModuleRecord* moduleRecord =
        sourceCode.provider()->createModuleRecordFromCache(globalObject, moduleKey);
    if (moduleRecord) {
        // Skip parsing entirely!
        promise->fulfillWithNonPromise(globalObject, moduleRecord);
        return;
    }
}
// Fall through to normal parsing...
```

#### 3. Module Record Reconstruction (`ZigSourceProvider.cpp`)

The `createModuleRecordFromCache` method reconstructs a complete `JSModuleRecord`:

1. Deserialize variable environments (declared + lexical)
2. Create `JSModuleRecord` with `JSModuleRecord::create()`
3. Add requested modules (dependencies)
4. Add import entries
5. Add export entries (local, indirect, star exports)

## Usage

### Bun.build API

```typescript
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  compile: true,
  experimentalEsmBytecode: true, // Enable ESM bytecode cache
});
```

### Output Files

When `experimentalEsmBytecode` is enabled with `compile: true`, the bytecode is embedded directly into the single-file executable.

## Performance

### Benchmark Results

Tested with synthetic modules containing realistic JavaScript patterns (classes, async functions, generators, destructuring, spread operators, etc.)

#### ESM Bytecode Cache Performance

| Size   | Source | Binary Increase | No Cache  | With Cache | Improvement | Time Saved    |
| ------ | ------ | --------------- | --------- | ---------- | ----------- | ------------- |
| tiny   | 12 KB  | +16 KB          | 9.26 ms   | 10.13 ms   | -9.4%       | -0.87 ms      |
| small  | 28 KB  | +54 KB          | 9.78 ms   | 10.43 ms   | -6.7%       | -0.66 ms      |
| medium | 212 KB | +483 KB         | 13.92 ms  | 13.56 ms   | +2.6%       | +0.36 ms      |
| large  | 2 MB   | +4.9 MB         | 48.27 ms  | 41.83 ms   | **+13.4%**  | +6.44 ms      |
| xlarge | 10 MB  | +24 MB          | 214.80 ms | 192.13 ms  | **+10.6%**  | +22.67 ms     |
| huge   | 20 MB  | +49 MB          | 430.52 ms | 364.97 ms  | **+15.2%**  | **+65.56 ms** |

#### Comparison with CJS Bytecode Cache

| Size   | ESM Improvement | CJS Improvement | ESM Time Saved | CJS Time Saved |
| ------ | --------------- | --------------- | -------------- | -------------- |
| tiny   | -9.4%           | -4.6%           | -0.87 ms       | -0.43 ms       |
| small  | -6.7%           | -3.2%           | -0.66 ms       | -0.31 ms       |
| medium | +2.6%           | +3.6%           | +0.36 ms       | +0.53 ms       |
| large  | +13.4%          | +16.6%          | +6.44 ms       | +10.40 ms      |
| xlarge | +10.6%          | +14.4%          | +22.67 ms      | +39.99 ms      |
| huge   | +15.2%          | +19.4%          | +65.56 ms      | +109.84 ms     |

### Key Findings

1. **Break-even point**: ~200KB of source code
   - Below this threshold, bytecode cache overhead exceeds parsing time
   - Above this threshold, performance improvements are significant

2. **Large applications benefit most**:
   - 10-15% faster startup for ESM
   - 14-19% faster startup for CJS
   - Up to 65ms saved for ~20MB bundles (ESM)
   - Up to 110ms saved for ~20MB bundles (CJS)

3. **Binary size trade-off**:
   - ESM bytecode adds ~2.5x the source size
   - CJS bytecode adds ~4.5x the source size

4. **CJS vs ESM performance difference**:
   - CJS shows higher improvement percentages because:
     - CJS has additional `require()` resolution overhead
     - CJS bytecode skips both parsing AND bytecode generation
   - ESM bytecode currently skips parsing but bytecode is regenerated from cache

## Limitations

1. **Small files**: Not recommended for applications under ~200KB as the bytecode loading overhead exceeds parsing time savings.

2. **Binary size**: Bytecode significantly increases the compiled binary size. Consider this trade-off for deployment scenarios with size constraints.

3. **Experimental status**: This feature is experimental and the binary format may change in future versions.

## Future Improvements

1. **Bytecode execution from cache**: Currently, the bytecode is stored but JSC still regenerates it from the cached data. Direct bytecode execution would further improve performance.

2. **Lazy bytecode loading**: Load bytecode on-demand for modules that may not be executed.

3. **Incremental updates**: Support for updating individual module bytecode without rebuilding the entire cache.

## Technical Details

### What Gets Skipped

With ESM bytecode cache enabled, the following operations are skipped during module loading:

- **Lexical analysis**: Tokenizing the source code
- **Parsing**: Building the Abstract Syntax Tree (AST)
- **Module analysis**: Extracting import/export declarations
- **Scope analysis**: Determining variable bindings

### What Still Happens

- **Bytecode validation**: JSC validates the cached bytecode
- **Module linking**: Resolving import/export bindings between modules
- **Module evaluation**: Executing the module code

### Memory Considerations

The module metadata is kept in memory after loading to support:

- Module namespace object creation
- Dynamic import resolution
- Hot module replacement (future)
