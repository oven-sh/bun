# bun.lock Quick Reference Card

## Structure
```jsonc
{
  "lockfileVersion": 1,
  "workspaces": { /* path → package.json snapshot */ },
  "packages": { /* key → [id, url, metadata, hash] */ }
}
```

## Workspace Entry
```jsonc
"packages/app-a": {
  "name": "@monorepo/app-a",
  "version": "1.0.0",
  "dependencies": { "react": "18.2.0" },
  "devDependencies": { "@types/react": "18.2.45" }
}
```

## Package Entry (NPM)
```jsonc
"react": [
  "react@18.2.0",                    // [0] ID: name@version
  "",                                // [1] URL: "" = npm
  { "dependencies": { ... } },       // [2] Metadata
  "sha512-..."                       // [3] Integrity
]
```

## Package Entry (Workspace)
```jsonc
"@monorepo/shared": ["@monorepo/shared@workspace:packages/shared"]
```

## Multiple Versions (Namespacing)
```jsonc
// Most common (3 uses)
"react": ["react@18.2.0", "", {...}, "sha512-..."],

// Workspace-specific (1 use)
"@monorepo/legacy/react": ["react@17.0.2", "", {...}, "sha512-..."],

// Nested override
"@monorepo/legacy/react-dom/scheduler": ["scheduler@0.20.2", ...]
```

## Namespace Patterns
| Pattern | Example | Meaning |
|---------|---------|---------|
| `{pkg}` | `"react"` | Base version (most common) |
| `{ws}/{pkg}` | `"@monorepo/legacy/react"` | Workspace-specific |
| `{ws}/{parent}/{pkg}` | `"@monorepo/legacy/react-dom/scheduler"` | Nested in workspace dep |
| `{parent}/{pkg}` | `"send/ms"` | Parent package override |

## Metadata Fields
```jsonc
{
  "dependencies": { "dep": "^1.0.0" },      // Runtime deps
  "peerDependencies": { "react": "^18" },   // Peer deps
  "optionalDependencies": { ... },          // Optional deps
  "bin": { "cmd": "bin/cli.js" }            // Binaries
}
```

## Key Conversions

| Aspect | yarn.lock | bun.lock |
|--------|-----------|----------|
| **Format** | Custom text | JSONC |
| **Integrity** | `sha1-...` or `sha512-...` | Always `sha512-...` |
| **URL** | Full URL | `""` for npm |
| **Workspaces** | `file:...` or `link:...` | `workspace:path` |
| **Multi-version** | Separate entries | Namespaced keys |

## Algorithm: Version to Key

```typescript
function getPackageKey(name: string, version: string): string {
  const versions = getAllVersions(name);
  
  if (versions.length === 1) {
    return name;  // Base key
  }
  
  const mostCommon = getMostCommonVersion(name);
  if (version === mostCommon) {
    return name;  // Base key
  }
  
  // Find context (workspace or parent)
  const context = findVersionContext(name, version);
  return `${context}/${name}`;  // Namespaced
}
```

## Example: Complete Conversion

**Input (yarn.lock):**
```yaml
"react@^18.2.0", "react@18.2.0":
  version "18.2.0"
  resolved "https://registry.yarnpkg.com/react/-/react-18.2.0.tgz"
  integrity sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==
  dependencies:
    loose-envify "^1.1.0"
```

**Output (bun.lock):**
```jsonc
"react": [
  "react@18.2.0",
  "",
  {
    "dependencies": {
      "loose-envify": "^1.1.0"
    }
  },
  "sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ=="
]
```

## Edge Cases

### Empty Metadata
```jsonc
"lodash": ["lodash@4.17.21", "", {}, "sha512-..."]
```

### Workspace Dependency
```jsonc
// In workspaces section:
"packages/app-a": {
  "dependencies": { "@monorepo/shared": "workspace:*" }
}

// In packages section:
"@monorepo/shared": ["@monorepo/shared@workspace:packages/shared"]
```

### Git Dependency
```jsonc
"my-pkg": [
  "my-pkg@1.0.0",
  "git+https://github.com/user/repo.git#abc123",
  {},
  ""  // No integrity for git
]
```

## Validation Checklist

✅ Workspaces section has all workspace paths  
✅ Each workspace entry mirrors its package.json  
✅ Packages section has workspace references  
✅ NPM packages have [id, url, metadata, hash]  
✅ Multiple versions use namespaced keys  
✅ Most common version gets base key  
✅ All integrity hashes are sha512  
✅ NPM URLs are empty strings  
✅ Metadata only includes present fields  
✅ Trailing commas everywhere (JSONC)

## Test Commands

```bash
# Validate format
bun install

# Check no changes needed
bun install --frozen-lockfile

# List all packages
bun pm ls

# Verify specific package
bun pm ls react
```

## Common Mistakes

❌ Using full URLs instead of ""  
❌ Missing trailing commas  
❌ Including empty metadata fields  
❌ Wrong namespace for multi-version  
❌ Using yarn's file: instead of workspace:  
❌ Including workspace deps in metadata  
❌ Wrong integrity hash format  
❌ Not sorting keys alphabetically

Types for it fully at packages/bun-types/bun.d.ts:6318-6389