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

**Purpose**: Analyzes all import/export relationships across the module graph, determining module compatibility, resolving dependencies, and setting up the foundation for code generation. This is the critical first phase of linking that establishes how modules will interact in the final bundle.

**Core Algorithm**: The function operates in 6 distinct steps, each building on the previous to create a complete understanding of the module graph:

**Step 1: Determine CommonJS Module Classification**
This step analyzes import patterns to decide which modules must be treated as CommonJS vs ECMAScript modules, which affects how they're bundled and accessed.

*What happens*:
- Examines each import record to understand how modules are being used
- Marks modules as CommonJS when required by import patterns or file characteristics
- Sets up wrapper flags that determine code generation strategy

*Key decision logic*:
```javascript
// Import star or default import from a module with no ES6 exports
// forces that module to be treated as CommonJS
import * as ns from './empty-file'; // Forces './empty-file' to be CJS
import defaultValue from './empty-file'; // Forces './empty-file' to be CJS

// Regular named imports don't force CommonJS treatment
import { namedExport } from './empty-file'; // './empty-file' stays ES6 compatible
```

*Critical edge cases handled*:
- `require()` calls always force the target module to be CommonJS
- Dynamic imports (`import()`) behave like `require()` when code splitting is disabled
- Modules with `force_cjs_to_esm` flag get special ESM wrapper treatment
- Entry points get different wrapper treatment based on output format

*Example transformation*:
```javascript
// Input: module-a.js (has no exports)
// No code, just an empty file

// Input: module-b.js  
import * as a from './module-a.js';
console.log(a);

// Result: module-a.js is marked as exports_kind = .cjs, wrap = .cjs
// This ensures the namespace object 'a' exists at runtime
```

**Step 2: Dependency Wrapper Propagation**
This step ensures that any module importing a CommonJS module is properly set up to handle the wrapper functions that will be generated.

*What happens*:
- Traverses dependency chains to mark files that need wrapper functions
- Propagates wrapper requirements up the dependency tree
- Handles export star statements with dynamic exports

*Algorithm*:
```javascript
// For each module that needs wrapping:
function wrap(sourceIndex) {
  if (alreadyWrapped[sourceIndex]) return;
  
  // Mark this module as wrapped
  flags[sourceIndex].wrap = (isCommonJS ? .cjs : .esm);
  
  // Recursively wrap all modules that import this one
  for (importRecord in allImportsOfThisModule) {
    wrap(importRecord.sourceIndex);
  }
}
```

*Example cascade*:
```javascript
// File hierarchy:
// entry.js → utils.js → legacy.cjs

// legacy.cjs (CommonJS module)
exports.helper = function() { return 'help'; };

// utils.js (imports CommonJS)
import { helper } from './legacy.cjs'; // Forces utils.js to be wrapped

// entry.js (imports wrapped module)  
import { helper } from './utils.js'; // Forces entry.js to be wrapped

// Result: All three files get wrapper functions to maintain compatibility
```

**Step 3: Resolve Export Star Statements**
This step processes `export * from 'module'` statements by collecting all the actual exports from target modules and making them available in the current module.

*What happens*:
- Recursively traverses export star chains to collect all re-exported names
- Handles export star conflicts when multiple modules export the same name
- Ignores export stars from CommonJS modules (since their exports aren't statically analyzable)
- Generates code for expression-style loaders (JSON, CSS modules, etc.)

*Export star resolution algorithm*:
```javascript
// For: export * from './moduleA'; export * from './moduleB';
function resolveExportStars(currentModule) {
  for (exportStarTarget in currentModule.exportStars) {
    // Skip if target is CommonJS (exports not statically known)
    if (exportStarTarget.isCommonJS) continue;
    
    // Add all named exports from target, except 'default'
    for (exportName in exportStarTarget.namedExports) {
      if (exportName === 'default') continue; // export * never re-exports default
      
      if (!currentModule.resolvedExports[exportName]) {
        currentModule.resolvedExports[exportName] = exportStarTarget.exports[exportName];
      } else {
        // Mark as potentially ambiguous - multiple sources for same name
        currentModule.resolvedExports[exportName].potentiallyAmbiguous = true;
      }
    }
    
    // Recursively resolve nested export stars
    resolveExportStars(exportStarTarget);
  }
}
```

*Example resolution*:
```javascript
// constants.js
export const API_URL = 'https://api.example.com';
export const VERSION = '1.0.0';

// utils.js  
export const formatDate = (date) => date.toISOString();
export const API_URL = 'https://dev.api.example.com'; // Conflict!

// index.js
export * from './constants.js';
export * from './utils.js';

// Result: index.js exports formatDate, VERSION, and API_URL (marked as potentially ambiguous)
// Bundler will emit warning about API_URL conflict
```

*Expression-style loader code generation*:
During this step, files loaded with expression-style loaders (JSON, CSS modules, text files) have their lazy export statements converted to actual module exports:

```javascript
// styles.module.css → generates:
var styles_module_default = {
  container: "container_abc123",
  button: "button_def456 container_abc123", // includes composes
};

// data.json → generates:  
var data_default = { "name": "example", "version": "1.0" };
```

**Step 4: Match Imports with Exports**
This step connects import statements with their corresponding export definitions, creating the binding relationships needed for code generation.

*What happens*:
- For each import in each file, finds the corresponding export definition
- Handles re-exports by tracing through export chains  
- Creates dependency relationships between parts of different files
- Handles CommonJS compatibility for import/export objects
- Creates wrapper parts for modules that need runtime wrappers

*Import matching algorithm*:
```javascript
// For: import { helper } from './utils.js';
function matchImport(importRef, importSourceIndex) {
  let targetModule = importSourceIndex;
  let targetRef = importRef;
  
  // If this import is actually a re-export, follow the chain
  while (importsToBindMap[targetModule][targetRef]) {
    const reExportData = importsToBindMap[targetModule][targetRef];
    targetModule = reExportData.sourceIndex;
    targetRef = reExportData.importRef;
  }
  
  // Add dependency from importing part to all parts that declare the symbol
  const declaringParts = symbolToPartsMap[targetModule][targetRef];
  for (partIndex of declaringParts) {
    importingPart.dependencies.add({
      sourceIndex: targetModule,
      partIndex: partIndex
    });
  }
}
```

*Example import resolution*:
```javascript
// math.js
export const PI = 3.14159;
export function square(x) { return x * x; } // Declared in part 0

// utils.js  
export { PI, square } from './math.js'; // Re-export in part 0

// app.js
import { square } from './utils.js'; // Part 1 imports square
console.log(square(5)); // Usage in part 1

// Result: app.js part 1 depends on math.js part 0 (where square is declared)
// The re-export through utils.js is tracked but doesn't create additional dependencies
```

*CommonJS compatibility handling*:
```javascript
// For CommonJS entry points in ES module output format:
if (isEntryPoint && outputFormat === 'esm' && moduleKind === 'cjs') {
  // Mark exports/module symbols as unbound so they don't get renamed
  symbols[exportsRef].kind = .unbound; // Keep "exports" name
  symbols[moduleRef].kind = .unbound;  // Keep "module" name
}
```

**Step 5: Create Namespace Exports**
This step generates the namespace export objects that ES6 import star statements and CommonJS interop require.

*What happens*:
- Executed in parallel across all reachable files for performance
- Creates export objects for modules that need them (CommonJS modules, star imports)
- Resolves ambiguous re-exports by choosing the first declaration found
- Generates sorted export alias lists for deterministic output

*Namespace object creation logic*:
```javascript
// For a module with exports: { helper, version, DEFAULT }
// Creates namespace object like:
{
  helper: helper_symbol_ref,
  version: version_symbol_ref,  
  default: DEFAULT_symbol_ref,
  [Symbol.toStringTag]: 'Module',
  __esModule: true // For CommonJS interop
}
```

*Example*:
```javascript
// utils.js
export const helper = () => 'help';
export const version = '1.0';
export default 'DEFAULT_VALUE';

// app.js  
import * as utils from './utils.js';
console.log(utils.helper()); // Accesses namespace object

// Generated namespace object for utils.js:
var utils_exports = {
  helper: helper,
  version: version, 
  default: 'DEFAULT_VALUE',
  __esModule: true
};
```

**Step 6: Bind Imports to Exports**
The final step creates the actual dependency relationships and generates runtime symbol imports for bundler helper functions.

*What happens*:
- Generates symbol import declarations for runtime helper functions (`__toESM`, `__toCommonJS`, etc.)
- Creates entry point dependencies to ensure all exports are included
- Sets up cross-chunk binding code for code splitting scenarios
- Handles wrapper function dependencies and exports object dependencies

*Runtime helper usage examples*:
```javascript
// __toESM: Used when importing CommonJS with ES6 syntax
import utils from './commonjs-module.js';
// Generates: __toESM(require('./commonjs-module.js'))

// __toCommonJS: Used when requiring ES6 module  
const utils = require('./es6-module.js');
// Generates: __toCommonJS(es6_module_exports)

// __require: Used for external require() calls in non-CommonJS output
const path = require('path'); 
// Generates: __require('path')

// __reExport: Used for export star from external modules
export * from 'external-package';
// Generates: __reExport(exports, require('external-package'))
```

*Entry point dependency handling*:
```javascript
// For entry points, ensure all exports are included in final bundle
for (exportAlias of entryPointExports) {
  const exportDef = resolvedExports[exportAlias];
  const declaringParts = getPartsDeclaringSymbol(exportDef.sourceIndex, exportDef.ref);
  
  // Add dependencies from entry point to all parts that declare exports
  entryPointPart.dependencies.addAll(declaringParts);
}
```

*Wrapper function dependency setup*:
```javascript
// When a module needs wrapping, other modules must depend on its wrapper
if (targetModule.needsWrapper) {
  // Import the wrapper function instead of direct module access
  currentPart.dependencies.add({
    sourceIndex: targetModule.index,
    ref: targetModule.wrapperRef // Points to require_moduleName() function
  });
  
  // For ES6 imports of CommonJS, add __toESM wrapper
  if (importKind !== 'require' && targetModule.isCommonJS) {
    record.wrapWithToESM = true;
    generateRuntimeSymbolImport('__toESM');
  }
}
```

**Key Data Structures Modified**:

- `exports_kind[]`: Classification of each module (`.cjs`, `.esm`, `.esm_with_dynamic_fallback`, `.none`)
- `flags[].wrap`: Wrapper type needed (`.none`, `.cjs`, `.esm`) 
- `resolved_exports[]`: Map of export names to their source definitions
- `imports_to_bind[]`: Map of import references to their target definitions
- `parts[].dependencies[]`: Cross-file part dependencies for bundling
- `import_records[].wrap_with_*`: Flags for runtime wrapper function calls

**Error Handling**: The function includes comprehensive validation:
- CSS modules `composes` property validation across files
- Top-level await compatibility checking
- Export star ambiguity detection and warning
- Import resolution failure detection

**Performance Optimizations**:
- Step 5 runs in parallel across all files using worker thread pool
- Symbol table mutations are batched to avoid memory allocations
- Dependency graph updates use pre-allocated capacity
- Export star cycle detection prevents infinite loops

This function is the foundation of Bun's module compatibility system, ensuring that mixed ES6/CommonJS codebases work correctly while enabling optimal bundling strategies.

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
