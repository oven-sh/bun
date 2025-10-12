# Annotated bun.lock Structure

## Complete File with Detailed Annotations

```jsonc
{
  "lockfileVersion": 1,  // Format version
  
  // ============================================================================
  // WORKSPACES SECTION: Mirror of package.json dependencies
  // ============================================================================
  "workspaces": {
    
    // Root workspace (empty string key)
    "": {
      "name": "monorepo-root",
      "devDependencies": {
        "prettier": "3.1.1",      // Exact version from package.json
        "typescript": "5.3.3",
      },
    },
    
    // Workspace at packages/app-a
    "packages/app-a": {
      "name": "@monorepo/app-a",
      "version": "1.0.0",
      "dependencies": {
        "@monorepo/shared": "workspace:*",  // ← Workspace protocol preserved!
        "lodash": "4.17.21",                // Different from app-b (4.17.20)
        "react": "18.2.0",
        "react-dom": "18.2.0",
      },
      "devDependencies": {
        "@types/lodash": "4.14.202",
        "@types/react": "18.2.45",
      },
    },
    
    // Workspace at packages/app-b
    "packages/app-b": {
      "name": "@monorepo/app-b",
      "version": "1.0.0",
      "dependencies": {
        "@monorepo/shared": "workspace:*",  // Same workspace reference
        "axios": "1.6.2",                   // Only app-b uses axios
        "lodash": "4.17.20",                // ← Different version than app-a!
        "react": "18.2.0",                  // Same as app-a
        "react-dom": "18.2.0",
      },
      "devDependencies": {
        "@types/react": "18.2.45",
      },
    },
    
    // Workspace at packages/legacy
    "packages/legacy": {
      "name": "@monorepo/legacy",
      "version": "1.0.0",
      "dependencies": {
        "express": "4.18.2",
        "react": "17.0.2",       // ← Different React version!
        "react-dom": "17.0.2",   // ← Old react-dom
      },
    },
    
    // Workspace at packages/shared
    "packages/shared": {
      "name": "@monorepo/shared",
      "version": "1.0.0",
      "dependencies": {
        "react": "18.2.0",
        "zod": "3.22.4",
      },
      "peerDependencies": {      // ← peerDependencies preserved
        "react": "^18.0.0",
      },
    },
  },
  
  // ============================================================================
  // PACKAGES SECTION: Flat map of all resolved packages
  // ============================================================================
  "packages": {
    
    // -------------------------------------------------------------------------
    // Workspace References
    // -------------------------------------------------------------------------
    "@monorepo/app-a": [
      "@monorepo/app-a@workspace:packages/app-a"  // Just a pointer
    ],
    "@monorepo/app-b": [
      "@monorepo/app-b@workspace:packages/app-b"
    ],
    "@monorepo/legacy": [
      "@monorepo/legacy@workspace:packages/legacy"
    ],
    "@monorepo/shared": [
      "@monorepo/shared@workspace:packages/shared"
    ],
    
    // -------------------------------------------------------------------------
    // Type Definitions
    // -------------------------------------------------------------------------
    "@types/lodash": [
      "@types/lodash@4.14.202",  // [0] Package ID
      "",                        // [1] Resolution (empty = npm)
      {},                        // [2] Metadata (no deps/bins)
      "sha512-OvlIYQK9tNneDlS0VN54LLd5uiPCBOp7gS5Z0f1mjoJYBrtStzgmJBxONW3U6OZqdtNzZPmn9BS/7WI7BFFcFQ=="  // [3] Integrity
    ],
    
    "@types/react": [
      "@types/react@18.2.45",
      "",
      {
        "dependencies": {         // ← Has dependencies!
          "@types/prop-types": "*",
          "@types/scheduler": "*",
          "csstype": "^3.0.2"
        }
      },
      "sha512-TtAxCNrlrBp8GoeEp1npd5g+d/OejJHFxS3OWmrPBMFaVQMSN0OFySozJio5BHxTuTeug00AVXVAjfDSfk+lUg=="
    ],
    
    // -------------------------------------------------------------------------
    // Single Version Packages (Most Common)
    // -------------------------------------------------------------------------
    "prettier": [
      "prettier@3.1.1",
      "",
      {
        "bin": {                  // ← Binary metadata
          "prettier": "bin/prettier.cjs"
        }
      },
      "sha512-22UbSzg8luF4UuZtzgiUOfcGM8s4tjBv6dJRT7j275NXsy2jb4aJa4NNveul5x4eqlF1wuhuR2RElK71RvmVaw=="
    ],
    
    "typescript": [
      "typescript@5.3.3",
      "",
      {
        "bin": {                  // ← Multiple binaries
          "tsc": "bin/tsc",
          "tsserver": "bin/tsserver"
        }
      },
      "sha512-pXWcraxM0uxAS+tN0AG/BF2TyqmHO014Z070UsJ+pFvYuRSq8KH8DmWpnbXe0pEPDHXZV3FcAbJkijJ5oNEnWw=="
    ],
    
    // -------------------------------------------------------------------------
    // MULTIPLE VERSIONS: Different lodash versions
    // -------------------------------------------------------------------------
    "lodash": [
      "lodash@4.17.21",          // ← Most common version (used by app-a)
      "",
      {},
      "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="
    ],
    
    "@monorepo/app-b/lodash": [  // ← Namespaced to app-b workspace
      "lodash@4.17.20",          // Different version!
      "",
      {},
      "sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA=="
    ],
    
    // -------------------------------------------------------------------------
    // MULTIPLE VERSIONS: Different React versions
    // -------------------------------------------------------------------------
    "react": [
      "react@18.2.0",            // ← Most common (app-a, app-b, shared)
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0"
        }
      },
      "sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ=="
    ],
    
    "@monorepo/legacy/react": [  // ← Namespaced to legacy workspace
      "react@17.0.2",            // Older version
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0",
          "object-assign": "^4.1.1"  // ← React 17 needs object-assign
        }
      },
      "sha512-gnhPt75i/dq/z3/6q/0asP78D0u592D5L1pd7M8P+dck6Fu/jJeL6iVVK23fptSUZj8Vjf++7wXA8UNclGQcbA=="
    ],
    
    // -------------------------------------------------------------------------
    // MULTIPLE VERSIONS: React DOM versions
    // -------------------------------------------------------------------------
    "react-dom": [
      "react-dom@18.2.0",
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0",
          "scheduler": "^0.23.0"   // ← Different scheduler version
        },
        "peerDependencies": {
          "react": "^18.2.0"       // ← Peer dependency preserved
        }
      },
      "sha512-6IMTriUmvsjHUjNtEDudZfuDQUoWXVxKHhlEGSk81n4YFS+r/Kl99wXiwlVXtPBtJenozv2P+hxDsw9eA7Xo6g=="
    ],
    
    "@monorepo/legacy/react-dom": [
      "react-dom@17.0.2",
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0",
          "object-assign": "^4.1.1",
          "scheduler": "^0.20.2"   // ← Different scheduler!
        },
        "peerDependencies": {
          "react": "17.0.2"        // ← Different peer dep version
        }
      },
      "sha512-s4h96KtLDUQlsENhMn1ar8t2bEa+q/YAtj8pPPdIjPDGBDIVNsrD9aXNWqspUe6AzKCIG0C1HZZLqLV7qpOBGA=="
    ],
    
    // -------------------------------------------------------------------------
    // DEEPLY NESTED VERSION OVERRIDE
    // -------------------------------------------------------------------------
    "scheduler": [
      "scheduler@0.23.2",        // ← Standard version (for React 18)
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0"
        }
      },
      "sha512-UOShsPwz7NrMUqhR6t0hWjFduvOzbtv7toDH1/hIrfRNIDBnnBWd0CwJTGvTpngVlmwGCdP9/Zl/tVrDqcuYzQ=="
    ],
    
    "@monorepo/legacy/react-dom/scheduler": [  // ← Nested namespace!
      "scheduler@0.20.2",        // Version for React 17's react-dom
      "",
      {
        "dependencies": {
          "loose-envify": "^1.1.0",
          "object-assign": "^4.1.1"
        }
      },
      "sha512-2eWfGgAqqWFGqtdMmcL5zCMK1U8KlXv8SQFGglL3CEtd0aDVDWgeF/YoCmvln55m5zSk3J/20hTaSBeSObsQDQ=="
    ],
    
    // -------------------------------------------------------------------------
    // TRANSITIVE DEPENDENCY VERSION OVERRIDE
    // -------------------------------------------------------------------------
    "ms": [
      "ms@2.0.0",                // Standard version (for debug@2.6.9)
      "",
      {},
      "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A=="
    ],
    
    "send/ms": [                 // ← Namespaced to parent package 'send'
      "ms@2.1.3",                // Different version needed by send
      "",
      {},
      "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA=="
    ],
    
    // -------------------------------------------------------------------------
    // Complex Package: axios with all its dependencies
    // -------------------------------------------------------------------------
    "axios": [
      "axios@1.6.2",
      "",
      {
        "dependencies": {        // ← All transitive deps listed
          "follow-redirects": "^1.15.0",
          "form-data": "^4.0.0",
          "proxy-from-env": "^1.1.0"
        }
      },
      "sha512-7i24Ri4pmDRfJTR7LDBhsOTtcm+9kjX5WiY1X3wIisx6G9So3pfMkEiU7emUBe46oceVImccTEM3k6C5dbVW8A=="
    ],
    
    // -------------------------------------------------------------------------
    // Express and its massive dependency tree
    // -------------------------------------------------------------------------
    "express": [
      "express@4.18.2",
      "",
      {
        "dependencies": {        // ← Huge dependency list
          "accepts": "~1.3.8",
          "array-flatten": "1.1.1",
          "body-parser": "1.20.1",
          "content-disposition": "0.5.4",
          "content-type": "~1.0.4",
          "cookie": "0.5.0",
          "cookie-signature": "1.0.6",
          "debug": "2.6.9",
          "depd": "2.0.0",
          "encodeurl": "~1.0.2",
          "escape-html": "~1.0.3",
          "etag": "~1.8.1",
          "finalhandler": "1.2.0",
          "fresh": "0.5.2",
          "http-errors": "2.0.0",
          "merge-descriptors": "1.0.1",
          "methods": "~1.1.2",
          "on-finished": "2.4.1",
          "parseurl": "~1.3.3",
          "path-to-regexp": "0.1.7",
          "proxy-addr": "~2.0.7",
          "qs": "6.11.0",
          "range-parser": "~1.2.1",
          "safe-buffer": "5.2.1",
          "send": "0.18.0",
          "serve-static": "1.15.0",
          "setprototypeof": "1.2.0",
          "statuses": "2.0.1",
          "type-is": "~1.6.18",
          "utils-merge": "1.0.1",
          "vary": "~1.1.2"
        }
      },
      "sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ=="
    ],
    
    // ... (remaining packages follow same pattern)
  }
}
```

## Key Patterns Discovered

### 1. Namespace Hierarchy
```
{package-name}                           ← Most common version
{workspace-name}/{package-name}          ← Workspace-specific version
{workspace-name}/{parent}/{package-name} ← Nested dependency override
{parent-package}/{package-name}          ← Parent package override
```

### 2. Version Selection Algorithm (Inferred)
1. Count how many times each version is requested
2. Most frequent version gets base key
3. Less frequent versions get namespaced keys
4. Ties broken by... (need to test, probably lexicographic or first-seen)

### 3. Metadata Presence Rules
- `dependencies`: Only present if package has dependencies
- `peerDependencies`: Only present if package declares peer deps
- `bin`: Only present if package has binary executables
- Empty `{}` if none of the above

### 4. Integrity Hash Format
- Always SHA-512
- Prefix: `"sha512-"`
- Not present for workspace packages
- Not present for intermediate array entries (only on last element)
Types for it fully at packages/bun-types/bun.d.ts:6318-6389