# Bun Lockfile Format Analysis

This directory contains a detailed analysis of Bun's lockfile format, generated from a complex monorepo structure designed to test all edge cases.

## Files

1. **`bun.lock`** - The actual generated lockfile (262 lines)
2. **`BUNLOCK_ANALYSIS.md`** - Comprehensive field-by-field analysis
3. **`BUNLOCK_ANNOTATED.md`** - Annotated version with inline explanations
4. **`CONVERSION_STRATEGY.md`** - yarn.lock → bun.lock conversion strategy

## Monorepo Structure

```
test-bun-lock-analysis/
├── package.json (root workspace)
├── packages/
│   ├── app-a/
│   │   └── package.json (React 18, lodash 4.17.21)
│   ├── app-b/
│   │   └── package.json (React 18, lodash 4.17.20, axios)
│   ├── legacy/
│   │   └── package.json (React 17, express)
│   └── shared/
│       └── package.json (React 18, zod, peerDeps)
└── bun.lock (generated)
```

## Key Findings

### 1. File Format
- **Type:** JSONC (JSON with trailing commas)
- **Size:** 262 lines for 192 packages
- **Structure:** Two-section flat format

### 2. Workspaces Section
```jsonc
"workspaces": {
  "": { /* root */ },
  "packages/app-a": { /* workspace */ },
  // ...
}
```
- Keys are relative paths from repo root
- Values are package.json snapshots (name, version, deps)
- Workspace protocol preserved: `"workspace:*"`

### 3. Packages Section
```jsonc
"packages": {
  "prettier": [
    "prettier@3.1.1",    // Package ID
    "",                  // Resolution URL
    { "bin": {...} },    // Metadata
    "sha512-..."         // Integrity
  ]
}
```

### 4. Multiple Version Handling

**The Innovation:** Namespaced keys for version conflicts

```jsonc
// Most common version
"react": ["react@18.2.0", "", {...}, "sha512-..."],

// Workspace-specific version
"@monorepo/legacy/react": ["react@17.0.2", "", {...}, "sha512-..."],

// Nested dependency override
"@monorepo/legacy/react-dom/scheduler": ["scheduler@0.20.2", ...]
```

**Namespace Patterns:**
- `{package}` - base version
- `{workspace}/{package}` - workspace-specific
- `{workspace}/{parent}/{package}` - nested override
- `{parent}/{package}` - parent package override

### 5. Version Selection Algorithm (Inferred)

1. **Frequency counting:** Most-used version wins base key
2. **Namespacing:** Less common versions get scoped keys
3. Example:
   - `react@18.2.0` used by 3 workspaces → key: `"react"`
   - `react@17.0.2` used by 1 workspace → key: `"@monorepo/legacy/react"`

## Critical Insights for Conversion

### ✅ Straightforward
- Workspaces section: Direct copy from package.json files
- Package IDs: Use resolved versions from yarn.lock
- Workspace references: Convert to `workspace:path` format

### ⚠️ Moderate Complexity
- Version hoisting: Count frequency, assign base keys appropriately
- Namespace generation: Track dependency contexts
- Integrity hashes: Convert sha1/sha512 formats

### 🔴 High Complexity
- Metadata extraction: Need package.json data (not in yarn.lock)
- Nested overrides: Build full dependency tree to determine namespaces
- Transitive workspace deps: Resolve workspace → workspace → package chains

## Example Conversion

**Yarn Input:**
```yaml
"lodash@4.17.20", "lodash@4.17.21":
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==

"lodash@4.17.20":
  version "4.17.20"
  ...
```

**Bun Output:**
```jsonc
"lodash": [
  "lodash@4.17.21",
  "",
  {},
  "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="
],
"@monorepo/app-b/lodash": [
  "lodash@4.17.20",
  "",
  {},
  "sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA=="
]
```

## Testing the Format

```bash
# Verify Bun accepts this lockfile
bun install

# Check installed versions
bun pm ls

# Validate integrity
bun install --frozen-lockfile
```

## Next Steps for Implementation

1. ✅ Understand format (DONE)
2. ✅ Analyze edge cases (DONE)
3. ⏳ Implement workspace parser
4. ⏳ Implement version frequency counter
5. ⏳ Implement namespace key generator
6. ⏳ Build main converter
7. ⏳ Add metadata fetching (optional)
8. ⏳ Comprehensive testing

## Resources

- **Bun Docs:** https://bun.sh/docs/install/lockfile
- **Bun Source:** `src/install/lockfile/` in Bun repo
- **Test Monorepo:** This directory

## Summary

Bun's lockfile format is brilliantly simple:
- **Human-readable** JSON structure
- **Fast parsing** via structured format
- **Efficient storage** via flat key-value pairs
- **Smart deduplication** via namespaced keys
- **Clear ownership** via workspace sections

The key innovation is the **namespace-based multi-version system**, which allows multiple versions to coexist in a flat structure while maintaining clear dependency chains.
