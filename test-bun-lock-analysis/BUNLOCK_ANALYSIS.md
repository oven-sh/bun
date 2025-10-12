# Bun Lockfile Format Analysis

## Overview
Bun's lockfile is a **text-based JSONC** (JSON with Comments) format that uses a flat structure with two main sections: `workspaces` and `packages`.

## Top-Level Structure

```jsonc
{
  "lockfileVersion": 1,
  "workspaces": { ... },
  "packages": { ... }
}
```

## 1. Workspaces Section

### Format
Each workspace is keyed by its **relative path** from the monorepo root:
- `""` = root workspace
- `"packages/app-a"` = workspace at packages/app-a
- `"packages/shared"` = workspace at packages/shared

### Workspace Fields
```jsonc
"packages/app-a": {
  "name": "@monorepo/app-a",           // Package name
  "version": "1.0.0",                   // Package version
  "dependencies": {
    "@monorepo/shared": "workspace:*",  // Workspace protocol preserved
    "react": "18.2.0"                   // Exact version from package.json
  },
  "devDependencies": { ... },
  "peerDependencies": { ... }           // Only present if declared
}
```

**Key Observations:**
- Workspace dependencies use `"workspace:*"` protocol (preserved from package.json)
- All dependency versions are EXACTLY as specified in package.json
- Only dependency types that exist are included (no empty objects)

## 2. Packages Section

### Entry Format
The packages section is a flat map where each key represents a package identifier, and the value is an array of resolution entries.

### Basic Package Entry (Single Version)
```jsonc
"prettier": [
  "prettier@3.1.1",              // [0] Package ID
  "",                            // [1] Resolution URL (empty = npm registry)
  { "bin": { ... } },            // [2] Metadata object
  "sha512-..."                   // [3] Integrity hash
]
```

### Package Entry with Dependencies
```jsonc
"react": [
  "react@18.2.0",
  "",
  { 
    "dependencies": { 
      "loose-envify": "^1.1.0"   // Range as specified in package's package.json
    } 
  },
  "sha512-..."
]
```

### Workspace Package Entries
```jsonc
"@monorepo/app-a": [
  "@monorepo/app-a@workspace:packages/app-a"  // Special workspace protocol
]
```
- Only contains the package ID with workspace location
- No integrity hash (local package)
- No dependencies listed (already in workspaces section)

## 3. Multiple Versions Handling

When different workspaces require different versions of the same package, Bun uses **namespaced keys**:

### Standard Version (Most Common)
```jsonc
"lodash": [
  "lodash@4.17.21",  // Most common version gets the base key
  "", {}, "sha512-..."
]
```

### Alternate Versions (Namespaced)
```jsonc
"@monorepo/app-b/lodash": [  // Scoped to specific workspace
  "lodash@4.17.20",           // Different version
  "", {}, "sha512-..."
]
```

**Namespace Pattern:** `"{workspace-name}/{package-name}"`

### Complex Example: React Versions
```jsonc
// React 18.2.0 (most common - shared by app-a, app-b, shared)
"react": ["react@18.2.0", "", {...}, "sha512-..."],

// React 17.0.2 (legacy workspace only)
"@monorepo/legacy/react": ["react@17.0.2", "", {...}, "sha512-..."]
```

### Deeply Nested Version Overrides
```jsonc
// Different scheduler version for legacy react-dom
"@monorepo/legacy/react-dom/scheduler": [
  "scheduler@0.20.2",
  "",
  { "dependencies": {...} },
  "sha512-..."
]

// vs standard scheduler
"scheduler": ["scheduler@0.23.2", "", {...}, "sha512-..."]

// And another override for send package's ms dependency
"send/ms": ["ms@2.1.3", "", {}, "sha512-..."]
```

## 4. Package Array Structure

Each package entry is an array with 4 elements:

### Index 0: Package ID
- Format: `"{name}@{version}"`
- For workspaces: `"{name}@workspace:{path}"`

### Index 1: Resolution URL
- Empty string `""` = npm registry
- Could contain custom registry URLs or git URLs

### Index 2: Metadata Object
Possible fields:
- `dependencies`: Object mapping dependency names to semver ranges
- `peerDependencies`: Object mapping peer dependency names to ranges
- `bin`: Object mapping binary names to paths
- Other package.json metadata as needed

**Empty object `{}` if no metadata**

### Index 3: Integrity Hash
- SHA-512 hash prefixed with `"sha512-"`
- Not present for workspace packages
- Used for integrity verification

## 5. Dependency Resolution Strategy

### Version Hoisting
Bun appears to use a **most-common-version-wins** strategy:
- The most frequently used version gets the base key
- Less common versions are namespaced

Example:
- `react@18.2.0` used by 3 workspaces → key: `"react"`
- `react@17.0.2` used by 1 workspace → key: `"@monorepo/legacy/react"`

### Transitive Dependencies
```jsonc
"axios": [
  "axios@1.6.2",
  "",
  {
    "dependencies": {
      "follow-redirects": "^1.15.0",
      "form-data": "^4.0.0",
      "proxy-from-env": "^1.1.0"
    }
  },
  "sha512-..."
]
```
- All transitive dependencies are listed in the dependencies object
- Ranges are preserved as specified in the package's package.json

## 6. Workspace Dependency Linking

Workspace dependencies are NOT expanded in the packages section:

```jsonc
// In workspaces section:
"packages/app-a": {
  "dependencies": {
    "@monorepo/shared": "workspace:*"  // References other workspace
  }
}

// In packages section:
"@monorepo/shared": [
  "@monorepo/shared@workspace:packages/shared"  // Just the location
]
```

The resolver uses the workspace path to locate the actual package.

## Key Differences from yarn.lock

1. **Format**: JSONC vs Yarn's custom text format
2. **Structure**: Flat two-section structure vs nested entries
3. **Workspaces**: Explicitly separated in dedicated section
4. **Multiple Versions**: Namespaced keys vs separate entries
5. **Metadata**: Structured objects vs inline fields
6. **Integrity**: SHA-512 only vs multiple hash types

## Version Resolution Examples

### Single Version Across All Workspaces
```jsonc
"react": ["react@18.2.0", "", {...}, "sha512-..."]
// All workspaces requesting react@18.2.0 share this entry
```

### Two Versions Required
```jsonc
"react": ["react@18.2.0", "", {...}, "sha512-..."],
"@monorepo/legacy/react": ["react@17.0.2", "", {...}, "sha512-..."]
// Workspace "legacy" gets 17.0.2, others get 18.2.0
```

### Three+ Versions (Theoretical)
```jsonc
"lodash": ["lodash@4.17.21", "", {}, "sha512-..."],
"@monorepo/app-b/lodash": ["lodash@4.17.20", "", {}, "sha512-..."],
"@monorepo/app-c/lodash": ["lodash@4.17.19", "", {}, "sha512-..."]
```

## Summary

The bun.lock format is designed for:
- **Human readability** (JSONC format)
- **Fast parsing** (structured JSON)
- **Efficient lookups** (flat key-value structure)
- **Version deduplication** (hoisting with namespacing)
- **Workspace clarity** (dedicated section)

The key innovation is the **namespaced package keys** which allow multiple versions to coexist in a flat structure while maintaining clear ownership chains.
Types for it fully at packages/bun-types/bun.d.ts:6318-6389