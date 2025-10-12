# yarn.lock → bun.lock Conversion Strategy

## Target Format Summary

Based on analysis of the generated bun.lock, here's what we need to produce:

## 1. Overall Structure

```typescript
interface BunLockfile {
  lockfileVersion: 1;
  workspaces: Record<string, WorkspaceEntry>;
  packages: Record<string, PackageEntry>;
}
```

## 2. Workspaces Section

```typescript
interface WorkspaceEntry {
  name: string;
  version?: string;  // Omit for root workspace if not present
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
```

**Rules:**
- Key is the relative path from repo root (`""` for root)
- Copy dependency specs EXACTLY from package.json (including `workspace:*`)
- Only include dependency types that exist (don't add empty objects)
- Preserve version field if present in package.json

## 3. Packages Section

```typescript
type PackageEntry = 
  | [string]  // Workspace reference
  | [string, string, MetadataObject, string];  // NPM package

interface MetadataObject {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bin?: Record<string, string> | string;
  // ... other metadata
}
```

**Entry Format:**
```typescript
// Workspace package
"@scope/package-name": ["@scope/package-name@workspace:path/to/package"]

// NPM package
"package-name": [
  "package-name@version",     // [0] Package ID
  "",                         // [1] Resolution URL (empty for npm)
  {                           // [2] Metadata
    dependencies: { ... },
    bin: { ... }
  },
  "sha512-..."                // [3] Integrity hash
]
```

## 4. Multiple Version Handling

**Namespace Key Generation Algorithm:**

1. **Single version** → Use package name as key:
   ```typescript
   "lodash": ["lodash@4.17.21", "", {}, "sha512-..."]
   ```

2. **Multiple versions** → Use namespacing:
   - Most common version gets base key
   - Less common versions get namespaced keys
   
   ```typescript
   // Count: react@18.2.0 (3 uses), react@17.0.2 (1 use)
   "react": ["react@18.2.0", "", {...}, "sha512-..."]
   "@monorepo/legacy/react": ["react@17.0.2", "", {...}, "sha512-..."]
   ```

3. **Namespace patterns:**
   ```
   // Workspace-specific
   {workspace-name}/{package-name}
   
   // Nested dependency
   {workspace-name}/{parent-package}/{package-name}
   
   // Parent package override
   {parent-package}/{package-name}
   ```

## 5. Key Mapping Rules

### From yarn.lock to bun.lock

**Yarn Entry:**
```yaml
"package-name@^1.0.0":
  version "1.0.5"
  resolved "https://..."
  integrity sha512-...
  dependencies:
    dep1 "^2.0.0"
```

**Bun Entry:**
```jsonc
"package-name": [
  "package-name@1.0.5",  // Use resolved version, not request range
  "",                    // Empty string for npm registry
  {
    "dependencies": {
      "dep1": "^2.0.0"   // Keep original range from package's package.json
    }
  },
  "sha512-..."           // Convert sha512-base64 format
]
```

### Important Conversions

1. **Integrity Hash:**
   - Yarn: `sha512-base64hash` or `sha1-base64hash`
   - Bun: Always `sha512-base64hash`
   - If yarn has sha1, you'll need to fetch sha512 or convert

2. **Resolution URL:**
   - Yarn: Full URL like `https://registry.yarnpkg.com/...`
   - Bun: Empty string `""` for npm registry
   - For git/other: Preserve the URL

3. **Workspace References:**
   - Yarn: May use file:... or link:...
   - Bun: Always `workspace:path`

## 6. Critical Challenges

### Challenge 1: Version Hoisting Strategy
**Problem:** How to determine which version gets the base key?

**Solution Options:**
1. Count frequency across all workspaces (most common wins)
2. Lexicographic ordering (higher version wins)
3. First-seen wins
4. Match Bun's actual algorithm (needs testing)

**Recommended:** Count frequency, with lexicographic tiebreaker

### Challenge 2: Namespace Generation
**Problem:** When to use which namespace pattern?

**Observations from bun.lock:**
- `@monorepo/legacy/react` - workspace-specific version
- `@monorepo/legacy/react-dom/scheduler` - nested transitive dep
- `send/ms` - parent package override

**Algorithm:**
1. Build dependency tree for each workspace
2. For each package@version, track which workspace/parent requested it
3. If multiple versions exist:
   - Most common → base key
   - Workspace-specific → `{workspace}/{package}`
   - Nested in dependency tree → `{workspace}/{parent}/{package}` or `{parent}/{package}`

### Challenge 3: Metadata Extraction
**Problem:** yarn.lock doesn't store bin, peerDependencies metadata

**Solution:**
- Need to fetch package.json for each package from npm registry
- Or: Generate minimal bun.lock without metadata (may work?)
- Or: Cache package.json data during conversion

### Challenge 4: Workspace Detection
**Problem:** Identifying which packages are workspaces vs external

**Solution:**
1. Parse root package.json workspaces field
2. Glob to find all workspace package.json files
3. Build map of workspace names → paths
4. Mark these as workspace packages in bun.lock

## 7. Conversion Algorithm Outline

```typescript
async function convertYarnLockToBunLock(yarnLock: YarnLock, rootDir: string) {
  // Step 1: Parse workspaces
  const workspaces = await parseWorkspaces(rootDir);
  
  // Step 2: Build frequency map for version hoisting
  const versionFrequency = countVersionFrequency(yarnLock);
  
  // Step 3: Generate workspaces section
  const bunWorkspaces = generateWorkspacesSection(workspaces);
  
  // Step 4: Generate packages section
  const bunPackages: Record<string, PackageEntry> = {};
  
  // Add workspace references
  for (const [name, info] of Object.entries(workspaces)) {
    bunPackages[info.name] = [`${info.name}@workspace:${info.path}`];
  }
  
  // Add npm packages
  for (const [key, entry] of Object.entries(yarnLock)) {
    const { name, requestedRange } = parseYarnKey(key);
    const baseKey = determinePackageKey(name, entry.version, versionFrequency);
    
    bunPackages[baseKey] = [
      `${name}@${entry.version}`,
      resolveURL(entry.resolved),
      buildMetadata(entry),
      convertIntegrity(entry.integrity)
    ];
  }
  
  return {
    lockfileVersion: 1,
    workspaces: bunWorkspaces,
    packages: bunPackages
  };
}
```

## 8. Testing Strategy

To validate conversion correctness:

1. **Create test monorepo** ✓ (Done)
2. **Generate reference bun.lock** ✓ (Done)
3. **Convert yarn.lock → bun.lock** (To implement)
4. **Compare results:**
   - Workspaces section should match exactly
   - Packages section keys should match
   - Package entries should be equivalent
5. **Test with real Bun:**
   - Run `bun install` with generated bun.lock
   - Should install identical dependency tree
   - No warnings or errors

## 9. Next Steps

1. Implement version frequency counting
2. Implement namespace key generation
3. Handle metadata fetching (or skip if not critical)
4. Build workspace parser
5. Implement main conversion logic
6. Add comprehensive tests
7. Handle edge cases:
   - Git dependencies
   - File/link dependencies
   - Optional dependencies
   - Peer dependencies
   - Workspace ranges (^, ~, etc.)
   - Aliased packages

## 10. Open Questions

1. **Does Bun validate integrity hashes?** If yes, must preserve sha512
2. **Can we omit metadata?** Test if bin/peerDeps are required
3. **How does Bun handle missing packages?** Will it re-fetch?
4. **Namespace tiebreaker?** When frequency is equal, which version wins?
5. **Transitive workspace deps?** How to handle workspace A → workspace B → package@version?
Types for it fully at packages/bun-types/bun.d.ts:6318-6389