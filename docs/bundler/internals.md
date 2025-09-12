# Bundler Internals

This document provides an in-depth look at Bun's bundler architecture and internal systems. Understanding these internals can help you better optimize your builds, debug bundling issues, and contribute to the Bun project.

## Architecture Overview

Bun's bundler is implemented primarily in Zig with some C++ components for JavaScriptCore integration. It follows a multi-phase pipeline architecture designed for maximum performance and correctness.

### Core Components

The bundler consists of several key components that work together:

1. **Graph Builder** (`Graph.zig`) - Manages dependency relationships
2. **Parse Tasks** (`ParseTask.zig`) - Handles multi-threaded file parsing
3. **Linker** (`LinkerContext.zig`, `LinkerGraph.zig`) - Symbol resolution and optimization
4. **Chunk Generator** (`Chunk.zig`, `computeChunks.zig`) - Output file generation
5. **Symbol Manager** (`renameSymbolsInChunk.zig`) - Minification and symbol coordination

## Module System Interoperability

One of Bun's most sophisticated features is seamless ES6/CommonJS interoperability. The bundler uses a 6-step analysis process to ensure correct module behavior:

### Step 1: CommonJS Module Classification

The bundler analyzes import patterns to determine if a module should be treated as CommonJS:

- Detection of `require()` calls and `module.exports` usage
- Analysis of export patterns to determine module type
- Wrapper function necessity determination

### Step 2: Dependency Wrapper Propagation

When a CommonJS module imports an ES6 module (or vice versa), wrapper functions are inserted:

- `__toESM()` - Converts CommonJS exports to ES6 format
- `__toCommonJS()` - Converts ES6 exports to CommonJS format
- `__reExport()` - Handles re-export scenarios

### Step 3: Export Star Resolution

Complex resolution of `export * from` statements:

- Cycle detection to prevent infinite loops
- Conflict resolution when multiple modules export the same name
- Performance optimization for commonly used patterns

### Step 4: Import-to-Export Binding

Direct linking of import statements to their corresponding exports:

- Cross-module symbol binding
- Re-export chain following
- Dead code elimination based on actual usage

### Step 5: Namespace Export Creation

Creation of namespace objects for mixed module compatibility:

- Dynamic property access preservation
- Static analysis limitations handling
- Runtime compatibility with different module loaders

### Step 6: Runtime Helper Binding

Injection and optimization of runtime helper functions:

- Conditional helper inclusion based on actual usage
- Cross-chunk helper sharing for code splitting scenarios
- Performance optimization for hot paths

## Part-Based Dependency Analysis

Bun's bundler uses a sophisticated "parts" system for granular tree shaking and dependency tracking:

### File Parts Division

Each file is divided into logical parts based on:

- Top-level statements and declarations
- Import/export statements
- Function and class declarations
- Variable declarations and assignments

### Cross-File Dependencies

Parts can depend on parts in other files:

- Import statements create explicit dependencies
- Export references create implicit dependencies
- Dynamic imports create conditional dependencies
- Type-only imports are tracked separately

### Dead Code Elimination

The part system enables aggressive dead code elimination:

- Unused parts are completely removed
- Unused exports are eliminated even if the file is imported
- Conditional dependencies allow for dynamic import optimization
- Side-effect analysis prevents incorrect elimination

## Symbol Reference System

The bundler uses a packed 64-bit reference system for efficient symbol management:

### Ref Structure

```zig
pub const Ref = struct {
    source_index: u32,
    inner_index: u32,

    // Packs both indices into a single u64 for efficiency
    pub fn pack(self: Ref) u64 { ... }
    pub fn unpack(packed: u64) Ref { ... }
};
```

### Symbol Tables

Two-dimensional symbol tables enable parallel processing:

- First dimension: source files
- Second dimension: symbols within each file
- Parallel symbol processing without locks
- Cross-file symbol resolution

### Symbol Linking

The linking process coordinates symbols across the entire bundle:

- Local symbol renaming for minification
- Cross-chunk symbol sharing for code splitting
- Reserved name computation for different output formats
- Scope-aware renaming that preserves semantics

## Memory Management Architecture

### Threading Model

The bundler uses a sophisticated multi-threading approach:

- **Parse threads**: Handle file parsing and AST generation
- **Main thread**: Orchestrates bundling and linking
- **IO threads**: Handle file system operations separately

### Arena Allocators

Memory management uses mimalloc threadlocal heaps as arena allocators:

```zig
// Each thread gets its own heap for temporary allocations
var arena = mimalloc.threadlocal_heap();
defer arena.reset(); // Automatically cleanup when done
```

### Memory Lifecycle

- **Parse phase**: Threadlocal arenas for AST storage
- **Link phase**: Global allocators for cross-file data structures
- **Output phase**: Streaming allocators for efficient file writing
- **Cleanup**: Automatic arena disposal when bundling completes

## CSS Integration Architecture

### CSS Module Processing

Advanced CSS Modules support includes:

- Scoped class name generation with collision detection
- Cross-file `composes` validation and resolution
- Source map preservation through CSS transformations
- Integration with JavaScript chunking strategies

### CSS Chunking

CSS code splitting uses hash-based deduplication:

- Import order analysis to determine chunk boundaries
- Hash computation to detect duplicate CSS
- Cross-chunk CSS dependency resolution
- Optimal chunk size balancing

### CSS-in-JS Integration

Seamless integration with CSS-in-JS libraries:

- Build-time CSS extraction when possible
- Runtime CSS injection optimization
- Source map coordination between CSS and JS
- Tree shaking of unused CSS-in-JS styles

## Code Splitting Internals

### Chunking Algorithm

The bundler uses an entry point-based chunking strategy:

1. **Dependency Analysis**: Build complete dependency graph
2. **Common Module Detection**: Find modules used by multiple entry points
3. **Chunk Boundary Calculation**: Determine optimal chunk splits
4. **Symbol Coordination**: Ensure symbols are available across chunks

### Cross-Chunk Dependencies

When chunks depend on each other:

- Dynamic imports for chunk loading
- Symbol reference coordination
- Runtime chunk loading optimization
- Circular dependency detection and resolution

### Chunk Naming

Template-based naming with multiple token types:

- `[name]` - Original file name
- `[hash]` - Content hash for caching
- `[dir]` - Directory structure preservation
- `[ext]` - Appropriate file extension

## Advanced Optimizations

### Frequency-Based Minification

Symbol renaming uses frequency analysis:

- Most frequently used symbols get shortest names
- Cross-chunk frequency coordination
- Reserved name avoidance for different output formats
- Scope-aware renaming that preserves behavior

### Dead Code Elimination Enhancements

Beyond simple tree shaking:

- Side effect analysis with escape detection
- Cross-module usage analysis
- Conditional dependency elimination
- Template literal optimization

### Bundle Splitting Strategies

Intelligent bundle splitting for optimal loading:

- Vendor chunk separation for better caching
- Route-based splitting for SPAs
- Priority-based chunk loading
- HTTP/2 push integration

## Performance Considerations

### Parallel Processing

The bundler maximizes parallelism:

- File parsing happens in parallel across all CPU cores
- Symbol processing uses lock-free algorithms where possible
- IO operations are separated from CPU-intensive tasks
- Memory allocation is optimized for parallel access

### Incremental Compilation

For development builds:

- File change detection with efficient cache invalidation
- Partial graph rebuilding when dependencies change
- Source map preservation across incremental builds
- Hot module replacement integration

### Memory Efficiency

Optimizations to minimize memory usage:

- Streaming file processing for large bundles
- Temporary data cleanup during long-running builds
- Shared data structures for common patterns
- Lazy loading of optional bundler features

## Debugging and Diagnostics

### Build Analysis

Tools for understanding bundle composition:

- Dependency graph visualization data
- Chunk size analysis and optimization suggestions
- Module usage statistics
- Performance timing breakdowns

### Error Reporting

Sophisticated error reporting system:

- Source location preservation through transformations
- Contextual error messages with suggestions
- Build warning categorization and filtering
- Integration with IDE error reporting

## Extending the Bundler

### Plugin Architecture

The plugin system provides deep integration points:

- Parse-time hooks for custom syntax support
- Resolution hooks for custom module loading
- Transform hooks for code modification
- Output hooks for custom file generation

### Native Extensions

For performance-critical plugins:

- Native addon integration through NAPI
- Zero-copy data structures for large files
- Direct AST manipulation APIs
- Custom loader implementation

This internal architecture enables Bun's bundler to achieve both exceptional performance and correctness while supporting the full complexity of modern JavaScript applications.
