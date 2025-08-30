# PNPM vs Bun Lockfile Format Comparison

## Overview

Understanding the fundamental differences between PNPM and Bun lockfile formats is crucial for implementing proper migration. This document analyzes both formats and explains why certain migration challenges exist.

## PNPM Lockfile Structure

### Format Evolution
- **v6.0**: Improved readability, removed hashes from package IDs
- **v9.0**: Reduced duplication, better peer dependency handling

### Key Sections

#### 1. Settings
```yaml
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
```

#### 2. Importers (Workspace Packages)
```yaml
importers:
  .:  # Root workspace
    dependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0
  packages/ui:  # Sub-workspace
    dependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0
```

#### 3. Packages (v6) / Snapshots (v9)
```yaml
packages:
  react@18.2.0:
    resolution: {integrity: sha512-...}
    engines: {node: '>=0.10.0'}
    
snapshots:  # v9 format
  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0
```

#### 4. Dependency Path Format
- **v6**: `/react@18.2.0` or `/react@18.2.0(peer@1.0.0)`
- **v9**: `react@18.2.0` or `react@18.2.0(peer@1.0.0)`

### PNPM's Dependency Resolution Strategy

1. **Flat packages section**: All packages stored once with their exact versions
2. **Reference-based importers**: Workspaces reference packages by path/ID
3. **Peer dependency encoding**: Encoded in package paths like `pkg@1.0.0(peer@2.0.0)`
4. **Link dependencies**: Workspace packages use `link:../path` format

## Bun Lockfile Structure

### Format Overview
- **Binary format**: `.lockb` for performance
- **JSON format**: `bun.lock` for debugging/inspection
- **Workspace-aware**: Built-in workspace support

### Key Sections

#### 1. Lockfile Metadata
```json
{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root-package"
    },
    "packages/ui": {
      "name": "@repo/ui",
      "version": "1.0.0",
      "dependencies": {
        "react": "^18.2.0"
      }
    }
  }
}
```

#### 2. Packages Array
```json
{
  "packages": {
    "react": [
      "react@18.2.0",
      "",
      {},
      "sha512-integrity-hash"
    ]
  }
}
```

### Bun's Dependency Resolution Strategy

1. **Package ID system**: Numeric IDs for packages with hash-based lookup
2. **Workspace-first**: Workspaces are first-class citizens
3. **Resolution arrays**: Dependencies stored as arrays with [name, version, meta, integrity]
4. **String interning**: Efficient string storage and deduplication

## Key Differences & Migration Challenges

### 1. Package Identification

**PNPM**: Uses string paths as package identifiers
```yaml
packages:
  "react@18.2.0": {...}
  "react@18.2.0(react-dom@18.2.0)": {...}  # With peers
```

**Bun**: Uses numeric IDs with hash-based lookup
```zig
const package_id: Install.PackageID = 42;
const name_hash = stringHash("react");
```

**Migration Challenge**: Need to map PNPM paths to Bun's ID system while preserving peer dependencies.

### 2. Workspace Handling

**PNPM**: Workspace packages are in importers, referenced via `link:` 
```yaml
importers:
  packages/ui:
    dependencies:
      react:
        specifier: ^18.2.0
        version: link:../react
```

**Bun**: Workspaces are top-level with `workspace:*` references
```json
{
  "workspaces": {
    "packages/ui": {
      "dependencies": {
        "react": "workspace:*"
      }
    }
  }
}
```

**Migration Challenge**: Converting `link:` paths to `workspace:*` format and ensuring proper workspace package creation.

### 3. Peer Dependencies

**PNPM**: Encoded in package paths
```yaml
packages:
  "eslint-plugin-react@7.32.0(eslint@8.28.0)": {...}
```

**Bun**: Handled via separate resolution metadata
```zig
// Peer dependencies are resolved during package creation
// and stored in the package's dependency list
```

**Migration Challenge**: Parsing peer dependency suffixes and creating proper Bun dependency structures.

### 4. Version Constraints vs Exact Versions

**PNPM**: Stores both specifier and resolved version
```yaml
react:
  specifier: ^18.2.0    # What was requested
  version: 18.2.0       # What was resolved
```

**Bun**: Stores exact resolution information
```json
{
  "dependencies": {
    "react": "^18.2.0"   # Constraint
  },
  "packages": {
    "react": ["react@18.2.0", ...] # Exact resolution
  }
}
```

**Migration Challenge**: Converting PNPM's dual representation to Bun's constraint + resolution model.

### 5. Integrity and Metadata

**PNPM**: Stored in resolution object
```yaml
packages:
  "react@18.2.0":
    resolution: 
      integrity: sha512-...
      tarball: https://registry.npmjs.org/react/-/react-18.2.0.tgz
```

**Bun**: Stored in package array
```json
{
  "packages": {
    "react": [
      "react@18.2.0",     # Name@version
      "",                 # URL (optional)
      {},                 # Metadata
      "sha512-..."        # Integrity
    ]
  }
}
```

## Why PNPM Migration is Complex

### 1. **Structural Differences**
- PNPM: String-based, path-oriented, dual-format (YAML/lockfile)
- Bun: ID-based, workspace-centric, binary-optimized

### 2. **Peer Dependency Handling**
- PNPM: Encodes peers in package paths
- Bun: Resolves peers during dependency resolution

### 3. **Workspace Philosophy**
- PNPM: Workspaces are special importers
- Bun: Workspaces are fundamental building blocks

### 4. **Version Resolution**
- PNPM: Explicit specifier/version split
- Bun: Constraint + exact resolution

## Migration Strategy Insights

### What Works Well
1. **Direct package mapping**: PNPM packages → Bun packages
2. **Workspace detection**: Both formats have clear workspace concepts
3. **Basic dependencies**: Simple dependency relationships translate well

### What's Challenging
1. **Peer dependency parsing**: Complex path parsing required
2. **Version preservation**: Especially pre-release/build versions
3. **Circular references**: PNPM's flat structure vs Bun's hierarchical model
4. **String management**: PNPM strings need careful copying for Bun's string buffer

### Best Practices for Migration

1. **Parse before creating**: Fully understand PNPM structure before creating Bun packages
2. **Preserve workspace hierarchy**: Don't flatten workspace relationships
3. **Handle peers carefully**: Parse peer suffixes but don't overcomplicate
4. **Use standard formats**: Avoid complex URL schemes or custom approaches
5. **Follow Bun patterns**: Use existing Bun dependency creation patterns

## Performance Considerations

### PNPM Strengths
- Human-readable YAML format
- Explicit dependency relationships
- Good for debugging and inspection

### Bun Strengths  
- Binary format for speed
- Efficient string interning
- Optimized for package resolution

### Migration Performance
- Parse once, create efficiently
- Minimize string allocations
- Avoid redundant package creation
- Use Bun's built-in optimization patterns

## Conclusion

The key to successful PNPM → Bun migration is understanding that while both formats serve similar purposes, their philosophical approaches differ significantly:

- **PNPM**: Explicit, path-based, human-readable
- **Bun**: Optimized, ID-based, performance-focused

Successful migration requires respecting both formats' strengths while carefully bridging their architectural differences. The most critical insight is that **simple, direct translation usually works better than complex transformation logic**.