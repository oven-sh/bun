# Dynamic Import Tree-Shaking Implementation Notes

## Summary
This document describes the work done to implement tree-shaking for dynamic imports with static property access in Bun's bundler.

## Problem Statement
When code uses dynamic imports with static property access patterns like:
```javascript
const foo = await import("./bar");
console.log(foo.baz);  // Only 'baz' should be included, not other exports
```

Currently, the bundler includes ALL exports from the dynamically imported module, even though we can statically determine that only specific exports are used.

## Implementation Progress

### ✅ Completed: Parser-Side Changes

1. **Symbol Tracking for Dynamic Imports** (`src/ast/Symbol.zig`)
   - Added `dynamic_import_ref` field to track when a binding comes from a dynamic import
   - Allows the parser to identify which symbols are dynamic import results

2. **Detection of Dynamic Import Bindings** (`src/ast/visit.zig`)
   - Detects patterns like `const foo = await import("./bar")`
   - Marks the binding symbol with the import record index

3. **Property Access Transformation** (`src/ast/visitExpr.zig`)
   - When accessing properties on dynamic import bindings (e.g., `foo.baz`)
   - Converts these to `ImportIdentifier` nodes
   - Tracks accessed properties in `import_items_for_namespace` map
   - Properly sets up namespace aliases for the import items

4. **Test Suite** (`test/bundler/bundler_treeshake_dynamic.test.ts`)
   - Comprehensive tests for expected behavior
   - Tests multiple access patterns and edge cases

### ❌ Remaining Work: Bundler-Side Changes

The parser correctly identifies and transforms the AST, but the bundler still includes all exports from dynamic imports. The core issue is in how the bundler's linker handles dynamic imports differently from static imports.

#### Key Findings:

1. **Dynamic Import Processing** (`src/bundler/linker_context/scanImportsAndExports.zig`)
   - Line 737-744: Dynamic imports always generate a dependency on the entire exports object
   - Static imports (`kind == .stmt`) can use specific imports via `import_items_for_namespace`
   - Dynamic imports (`kind == .dynamic`) don't check this map

2. **Fundamental Challenge**:
   - Dynamic imports are resolved at runtime, not bundle time
   - The bundler must be conservative and include the entire module
   - Even with our ImportIdentifier tracking, the bundler doesn't know if the dynamic import will actually execute

3. **Potential Solutions**:

   **Option A: Limited Tree-Shaking for Guaranteed Dynamic Imports**
   - Only optimize patterns where we KNOW the import will execute
   - Example: Top-level `const foo = await import("./bar")`
   - Requires flow analysis to ensure the import isn't conditional

   **Option B: Create Separate Chunks with Lazy Loading**
   - Split dynamically imported modules into separate chunks
   - Each chunk only includes the exports that are statically known to be used
   - Requires significant bundler architecture changes

   **Option C: Transform to Static Imports**
   - During bundling, convert guaranteed dynamic imports to static imports
   - Only works for top-level await patterns
   - Loses the lazy-loading benefit of dynamic imports

## Next Steps

1. **Decide on Approach**: The Bun team needs to decide which approach aligns with the bundler's architecture and goals.

2. **Implement Bundler Changes**: Based on the chosen approach, modify:
   - `scanImportsAndExports.zig` to check `import_items_for_namespace` for dynamic imports
   - Potentially add flow analysis to detect guaranteed dynamic imports
   - Update how parts/dependencies are created for dynamic imports

3. **Handle Edge Cases**:
   - Destructuring: `const { a, b } = await import("./lib")`
   - Computed property access: `mod[key]` (should keep all exports)
   - Conditional imports: `if (condition) { await import("./lib") }`
   - Re-exports from dynamic imports

4. **Performance Testing**: Ensure tree-shaking doesn't significantly impact bundle time.

## Technical Details

### How Static Imports Work
1. Parser creates `ImportIdentifier` nodes for named imports
2. `import_items_for_namespace` maps namespace symbols to accessed properties
3. Bundler's `scanImportsAndExports` only imports used symbols via `generateSymbolImportAndUse`
4. Unused exports are never marked as live during tree-shaking

### How Dynamic Imports Currently Work
1. Parser creates `E.Import` expression nodes
2. Bundler always imports the entire exports object for dynamic imports
3. All exports from the module are included in the bundle
4. No tree-shaking occurs even if usage is statically analyzable

### What Our Changes Do
1. Track when a binding comes from a dynamic import
2. Convert property accesses to `ImportIdentifier` nodes
3. Record accessed properties in `import_items_for_namespace`
4. The bundler infrastructure is ready but not yet using this information

## Testing
Run the test suite with:
```bash
bun bd test test/bundler/bundler_treeshake_dynamic.test.ts
```

Currently, tests fail because the bundler doesn't tree-shake dynamic imports yet.

## References
- Original feature request: [Issue/Discussion needed]
- Related ESBuild issue: https://github.com/evanw/esbuild/issues/1591
- Dynamic import spec: https://tc39.es/ecma262/#sec-import-calls