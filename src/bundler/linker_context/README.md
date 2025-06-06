# LinkerContext Documentation

This directory contains functions on the `LinkerContext` struct which have been logically split up into separate files.

Many of the functions/files represent a pass or step over the bundle graph or chunks etc.

## Overview

The `LinkerContext` is the central orchestrator for Bun's bundling process. After the parser has created an AST representation of all input files, the `LinkerContext` takes over to perform linking, optimization, code splitting, and final code generation.

The LinkerContext operates in several main phases:

## Main Functions

### 1. `load()` - LinkerContext.zig:187

**Purpose**: Initializes the LinkerContext with bundle data and prepares the graph for linking.

**What it does**:

- Sets up the parse graph reference
- Configures code splitting and logging
- Loads entry points and reachable files into the graph
- Initializes wait groups for parallel processing
- Sets up runtime symbol references (`__esm`, `__commonJS`)
- Configures module/exports references for different output formats (CJS, IIFE)

**Key responsibilities**:

- Graph initialization and configuration
- Runtime symbol setup
- Entry point processing
- Memory management setup

### 2. `link()` - LinkerContext.zig:294

**Purpose**: The main linking orchestrator that coordinates all bundling phases.

**What it does**:

1. Calls `load()` to initialize the context
2. Computes source map data if needed
3. **Phase 1**: `scanImportsAndExports()` - Analyzes all imports/exports across modules
4. **Phase 2**: `treeShakingAndCodeSplitting()` - Eliminates dead code and determines chunk boundaries
5. **Phase 3**: `computeChunks()` - Creates the final chunk structure
6. **Phase 4**: `computeCrossChunkDependencies()` - Resolves dependencies between chunks
7. Follows symbol references to ensure consistency

**Key responsibilities**:

- Orchestrates the entire linking pipeline
- Error handling at each phase
- Memory corruption checks (in debug builds)
- Returns the final chunk array

### 3. `generateChunksInParallel()` - generateChunksInParallel.zig:1

**Purpose**: Generates the final output files from chunks using parallel processing.

**What it does**:

1. **Symbol Renaming Phase**: Renames symbols in each chunk in parallel to avoid conflicts
2. **Source Map Processing**: Handles line offset calculations for source maps
3. **CSS Preparation**: Processes CSS chunks, removing duplicate rules in serial order
4. **Code Generation Phase**: Generates compile results for each part in parallel
   - JavaScript chunks: Generates code for each part range
   - CSS chunks: Processes CSS imports and generates stylesheets
   - HTML chunks: Processes HTML files
5. **Post-processing Phase**: Finalizes chunks with cross-chunk imports/exports
6. **Output Phase**: Either writes files to disk or returns in-memory results

**Key responsibilities**:

- Parallel processing coordination
- Final code generation
- Source map finalization
- File output management

## Linking Pipeline Files

### Core Analysis Phase

#### `scanImportsAndExports.zig`

**Purpose**: Analyzes all import/export relationships across the module graph.

**Key functions**:

- Determines which modules must be CommonJS
- Processes CSS imports and assets
- Resolves import/export statements
- Handles dynamic imports
- Sets up wrapper functions for different module formats

#### `doStep5.zig`

**Purpose**: Creates namespace exports for every file.

**Key functions**:

- Generates namespace exports for CommonJS files
- Handles import star statements
- Resolves ambiguous re-exports
- Creates sorted export alias lists

### Optimization Phase

#### `renameSymbolsInChunk.zig`

**Purpose**: Renames symbols within chunks to avoid naming conflicts and enable minification.

**Key functions**:

- Computes reserved names to avoid conflicts
- Handles cross-chunk import renaming
- Implements identifier minification when enabled
- Manages symbol scoping and collision detection

### Chunk Computation Phase

#### `computeChunks.zig`

**Purpose**: Determines the final chunk structure based on entry points and code splitting.

**Key functions**:

- Creates separate chunks for each entry point
- Groups related files into chunks
- Handles CSS chunking strategies
- Manages HTML chunk creation
- Assigns unique keys and templates to chunks

#### `computeCrossChunkDependencies.zig`

**Purpose**: Resolves dependencies between different chunks.

**Key functions**:

- Analyzes imports between chunks
- Sets up cross-chunk binding code
- Handles dynamic imports across chunks
- Manages chunk metadata for dependency resolution

#### `findAllImportedPartsInJSOrder.zig`

**Purpose**: Determines the order of parts within JavaScript chunks.

**Key functions**:

- Orders files by distance from entry point
- Handles part dependencies within chunks
- Manages import precedence
- Ensures proper evaluation order

#### `findImportedCSSFilesInJSOrder.zig`

**Purpose**: Determines CSS file ordering for JavaScript chunks that import CSS.

**Key functions**:

- Orders CSS imports within JS chunks
- Handles CSS dependency resolution
- Manages CSS-in-JS import patterns

#### `findImportedFilesInCSSOrder.zig`

**Purpose**: Determines the import order for CSS files.

**Key functions**:

- Processes CSS @import statements
- Handles CSS dependency chains
- Manages CSS asset imports

### Code Generation Phase

#### `generateCodeForFileInChunkJS.zig`

**Purpose**: Generates JavaScript code for a specific file within a chunk.

**Key functions**:

- Converts AST statements to code
- Handles different module formats (ESM, CJS, IIFE)
- Manages HMR (Hot Module Replacement) code generation
- Processes wrapper functions and runtime calls

#### `generateCompileResultForJSChunk.zig`

**Purpose**: Worker function that generates compile results for JavaScript chunks in parallel.

**Key functions**:

- Thread-safe chunk compilation
- Memory management for worker threads
- Error handling in parallel context
- Integration with thread pool

#### `generateCompileResultForCssChunk.zig`

**Purpose**: Worker function that generates compile results for CSS chunks in parallel.

**Key functions**:

- CSS printing and minification
- Asset URL resolution
- CSS import processing
- Thread-safe CSS compilation

#### `generateCompileResultForHtmlChunk.zig`

**Purpose**: Worker function that generates compile results for HTML chunks.

**Key functions**:

- HTML processing and transformation
- Asset reference resolution
- HTML minification
- Script/stylesheet injection

#### `generateCodeForLazyExport.zig`

**Purpose**: Generates code for expression-style loaders that defer code generation until linking.

**Key functions**:

- Deferred code generation for expression-style loaders
- CSS modules export object creation with local scope names
- Handles CSS `composes` property resolution across files
- Converts lazy export statements to proper module exports (CJS or ESM)

**What are expression-style loaders?**: These are file loaders (like JSON, CSS, text, NAPI, etc.) that generate a JavaScript expression to represent the file content rather than executing imperative code. The expression is wrapped in a lazy export statement during parsing, and actual code generation is deferred until linking when the final export format is known.

**Example - JSON/Text files**: When you import `data.json` containing `{"name": "example"}`, the expression-style loader creates a lazy export with the expression `{name: "example"}`. During linking, `generateCodeForLazyExport` converts this to:

```javascript
// For ESM output:
var data_default = { name: "example" };

// For CJS output:
module.exports = { name: "example" };
```

**Example - CSS Modules**: For a CSS module file `styles.module.css` with:

```css
.container {
  background: blue;
}
.button {
  composes: container;
  border: none;
}
```

The function generates:

```javascript
var styles_module_default = {
  container: "container_-MSaAA",
  button: "container_-MSaAA button_-MSaAA", // includes composed classes
};
```

The function resolves `composes` relationships by visiting the referenced classes and building template literals that combine the scoped class names.

### Statement Processing

#### `convertStmtsForChunk.zig`

**Purpose**: Converts and transforms AST statements for final inclusion in output chunks, handling the critical process of adapting module-level statements for different output formats and wrapper contexts.

**Why this function is necessary**:
When bundling modules, Bun often needs to wrap module code in runtime functions to preserve module semantics (like namespace objects, CommonJS compatibility, etc.). This creates a challenge: ES module import/export statements MUST remain at the top level of the output file, but the module's actual code might need to be wrapped in a function. This function solves this by carefully separating statements that must stay at the top level from those that can be wrapped.

**Core responsibilities**:

1. **Module Wrapper Management**: Determines which statements can be placed inside wrapper functions vs. which must remain at the top level

2. **Import/Export Statement Processing**: Transforms import/export syntax based on output format and bundling context

   - Converts `export * from 'path'` to import statements when needed
   - Strips export keywords when bundling (since internal modules don't need exports)
   - Handles re-export runtime function calls

3. **CommonJS Compatibility**: Adds special handling for CommonJS entry points that need both ESM and CJS export objects

4. **Statement Placement Strategy**: Distributes statements across four categories:
   - `outside_wrapper_prefix`: Top-level statements before any wrapper (imports/exports)
   - `inside_wrapper_prefix`: Code that runs at the start of wrapper functions (re-exports)
   - `inside_wrapper_suffix`: The main module body (actual code)
   - `outside_wrapper_suffix`: Code after wrapper functions

**Key transformation patterns**:

**Pattern 1: Export Stripping**

```javascript
// Input (when bundling):
export function greet() { return 'hello'; }
export const name = 'world';
export default 42;

// Output (exports removed since internal to bundle):
function greet() { return 'hello'; }
const name = 'world';
var default = 42;
```

**Pattern 2: Import/Export Statement Extraction**
When a module needs wrapping (due to namespace preservation), import/export statements are extracted to the top level:

```javascript
// Input module that needs wrapping:
import * as utils from "./utils.js";
export const data = utils.process();

// Output with wrapper:
import * as utils from "./utils.js"; // ← extracted to outside_wrapper_prefix
var init_module = __esm(() => {
  // ← wrapper function
  const data = utils.process(); // ← inside wrapper
});
```

**Pattern 3: Re-export Runtime Handling**

```javascript
// Input:
export * from "./external-module";

// Output (when external module needs runtime re-export):
import * as ns from "./external-module"; // ← outside_wrapper_prefix
__reExport(exports, ns, module.exports); // ← inside_wrapper_prefix (runtime call)
```

**Pattern 4: CommonJS Entry Point Dual Exports**
For CommonJS entry points, the function creates dual export objects:

```javascript
// Internal ESM export object (no __esModule marker):
var exports = {};

// External CommonJS export object (with __esModule marker):
__reExport(exports, targetModule, module.exports); // module.exports gets __esModule
```

**Example: Complex Module Transformation**

Input file with mixed imports/exports:

```javascript
// demo.js
import * as utils from "./utils.js";
export * from "./constants.js";
export const greeting = "hello";
export default function () {
  return utils.format(greeting);
}

// When utils namespace is accessed dynamically elsewhere:
const prop = "format";
utils[prop]("test"); // Forces namespace preservation
```

After `convertStmtsForChunk` processing with wrapping enabled:

```javascript
// outside_wrapper_prefix (top-level):
import * as utils from './utils.js';
import * as ns_constants from './constants.js';

// inside_wrapper_prefix (start of wrapper):
__reExport(exports, ns_constants);

// inside_wrapper_suffix (main module body in wrapper):
var init_demo = __esm(() => {
  const greeting = 'hello';
  function default() { return utils.format(greeting); }
  // exports object setup...
});
```

**Statement processing algorithm**:

1. **Analyze context**: Determine if wrapping is needed and if exports should be stripped
2. **Process each statement**:
   - Import statements → Extract to `outside_wrapper_prefix` if wrapping
   - Export statements → Transform or remove based on bundling context
   - Regular statements → Place in `inside_wrapper_suffix`
   - Re-export calls → Generate runtime code in `inside_wrapper_prefix`
3. **Handle special cases**: Default exports, re-exports, CommonJS compatibility

**Critical edge cases handled**:

- **Export star from external modules**: Converted to import + runtime re-export call
- **Dynamic namespace access**: Preserves namespace objects when static analysis can't determine access patterns
- **Mixed module formats**: Handles ESM → CJS conversion while preserving semantics
- **Circular dependencies**: Ensures proper initialization order through wrapper placement

This function is essential for maintaining JavaScript module semantics across different output formats while enabling optimal bundling strategies.

#### `convertStmtsForChunkForDevServer.zig`

**Purpose**: Special statement conversion for development server (HMR).

**Key functions**:

- HMR-specific code generation
- Development-time optimizations
- Live reload integration

### Post-Processing Phase

#### `prepareCssAstsForChunk.zig`

**Purpose**: Prepares CSS ASTs before final processing.

**Key functions**:

- CSS rule deduplication
- CSS optimization passes
- Asset reference resolution

#### `postProcessJSChunk.zig`

**Purpose**: Final processing of JavaScript chunks after code generation.

**Key functions**:

- Cross-chunk binding code generation
- Final minification passes
- Source map integration
- Output formatting

#### `postProcessCSSChunk.zig`

**Purpose**: Final processing of CSS chunks.

**Key functions**:

- CSS rule optimization
- Asset URL finalization
- CSS minification
- Source map generation

#### `postProcessHTMLChunk.zig`

**Purpose**: Final processing of HTML chunks.

**Key functions**:

- HTML optimization
- Asset reference injection
- Script/stylesheet linking
- HTML minification

### Output Phase

#### `writeOutputFilesToDisk.zig`

**Purpose**: Writes all generated chunks and assets to the filesystem.

**Key functions**:

- File system operations
- Directory creation
- Chunk serialization
- Source map file generation
- Asset copying

## Data Flow

1. **Input**: Parsed AST from all source files
2. **Load Phase**: Initialize graph and runtime symbols
3. **Analysis Phase**: Scan imports/exports, determine module relationships
4. **Optimization Phase**: Tree shaking, code splitting, symbol renaming
5. **Chunk Phase**: Compute final chunk structure and dependencies
6. **Generation Phase**: Generate code for each chunk in parallel
7. **Post-processing Phase**: Finalize chunks with cross-chunk code
8. **Output Phase**: Write files to disk or return in-memory

## Parallelization Strategy

The LinkerContext makes extensive use of parallel processing:

- **Symbol renaming**: Each chunk's symbols are renamed in parallel
- **Code generation**: Each part range is compiled in parallel
- **CSS processing**: CSS chunks are processed in parallel
- **Source maps**: Source map calculations are parallelized
- **Post-processing**: Final chunk processing happens in parallel

This parallelization significantly improves bundling performance for large applications.
