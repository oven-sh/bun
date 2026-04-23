# `?bundle` Import Architecture

This document describes the design principles for `?bundle` imports (`import x from "./file?bundle" with { ... }`). Any agent working on this system MUST read and follow these principles.

## Core Principle: Build Once, Share Everywhere

When `bundle.ts` is imported by both `server.ts` and `worker.ts`, the `frontend.tsx?bundle` inside `bundle.ts` MUST be built **exactly once**. Both consumers MUST receive **identical manifests** (same file names, same hashes, same file count). This applies to ALL modes:

- **Non-hot runtime** (`bun server.ts`): First JSBundle.build() runs the full build and seeds the VM-wide SubBuildCache. Second JSBundle.build() for the same (path, config) hits the cache. One build.
- **Hot mode** (`bun --hot`): The dev server builds `frontend.tsx` as a standalone entry. Both server and worker reference the SAME dev server entry via runtime indirection (`__bun_submanifest`). One build.
- **--compile** (`bun build --compile`): First sub-build seeds the per-build sub_build_cache. Nested sub-builds (e.g., worker's sub-sub-build of frontend) inherit the parent's cache and hit it. One build.

## Core Principle: Shared Configuration

There is ONE code path that configures a Transpiler from a `BundleImportConfig`: `configureTranspilerForBundle()` in `src/bundler/bundle_config.zig`. ALL modes call this function (or use its logic for env/define setup). Mode-specific overrides (hot mode forces minify=false, sub-builds force output_dir="") are applied AFTER via `applyBundleModeOverrides()`.

**Why:** Previously each mode had its own ~50 lines of transpiler configuration. Fixing a bug in one mode didn't fix it in others.

The shared configuration function handles:
- target, format, splitting, minify, sourcemap, naming (from import attributes)
- env behavior + prefix (e.g., `env: "VITE_*"`)
- `configureDefines()` — loading .env files, setting NODE_ENV, creating process.env.* defines
- polyfill_node_globals for browser-like targets
- CSS chunking

## Build-Once Cache Strategy

Each mode has its own cache mechanism, but the PRINCIPLE is identical: keyed by `(path, BundleImportConfig)`, first build stores, second lookup hits.

- **Non-hot / --compile**: `SubBuildCache` (VM-wide or per-build). Stores production `OutputFile` objects.
- **Hot mode**: `BundleGroup` registry on DevServer. Stores HMR-format graph state.

These are separate caches because production and HMR produce different output formats (static chunks vs HMR-wrapped modules). But both use the same key, and the shared config function ensures both produce deterministic output for a given config.

**Hot mode sub-build resolution**: When a BundleGroup's build encounters `frontend.tsx?bundle` as a sub-build, it checks the BundleGroup registry FIRST. If a group already exists for that (path, config), it uses that group's manifest instead of building again. This is the hot-mode equivalent of hitting the SubBuildCache.

## How Each Mode Works

### Non-Hot Runtime (Path 1)
- Entry: `ModuleLoader.zig` → `JSBundle.build()`
- Transpiler: Fresh, configured via shared function (applied on BundleThread after `configureBundler` init)
- Build: Scheduled on JSBundleThread → BundleV2.runFromJSInNewThread
- Cache: Seeds VM-wide SubBuildCache in onBuildComplete; checks cache at top of build() and on BundleThread
- Manifest: From BundleV2 output files

### Hot Mode / Dev Server (Path 2)
- Entry: `ModuleLoader.zig` → `JSBundle.attachToSharedDevServer()`
- Transpiler: Dev server's shared client_transpiler, env configured via shared function's `configureDefines()` pipeline
- Build: Dev server incremental pipeline (internal_bake_dev format)
- BundleGroups: Each unique (path, config) gets a BundleGroup tracking entry state and consumers
- Cache: N/A (dev server handles dedup internally — one entry, one build)
- Manifest: From dev server state, accessed via `__bun_submanifest` runtime indirection in worker

### Sub-Build / --compile (Paths 3 & 4)
- Entry: Parent BundleV2 → collectSubBuilds → runSingleSubBuild
- Transpiler: Fresh, configured via shared function
- Build: BundleV2.runFromJSInNewThread (one-shot, in-memory)
- Cache: Per-build sub_build_cache (pre-seeded from parent); VM-wide SubBuildCache (if completion available)
- Manifest: Patched into parent AST via patchSubBuildExports

## Asset Handling

CSS, WASM, images, and other file-loader assets are tracked in the dev server's `assets` store:
- CSS: Stored during `finalizeBundle` CSS chunk processing
- File-loader assets (WASM, images): Stored during `finalizeBundle` after CSS processing
- All served at `/_bun/asset/<content_hash>.<ext>`
- Included in JSBundle `.files` array via `onDevServerBuildComplete`

## Things That MUST Stay In Sync

If you change any of these, verify ALL modes still work:

1. **Env define creation** — process.env.X must be inlined identically across all modes
2. **Naming templates** — default `[name]-[hash].[ext]` for both sub-builds and JSBundle.build()
3. **Cache keys** — `(path, BundleImportConfig)` must match between the build that seeds and the build that looks up
4. **Sub-build cache inheritance** — sub-builds MUST inherit parent's cache so nested ?bundle hits
5. **Source map handling** — external sourcemaps must produce .map files in all modes that support them

## Testing

After ANY change to ?bundle handling, run:
```
bun bd test test/bundler/bun-build-api.test.ts -t "import with"
```

## Key Files

- `src/bundler/bundle_config.zig` — **Shared configuration function** (THE source of truth)
- `src/bun.js/api/server/JSBundle.zig` — JSBundle lifecycle (build, onBuildComplete, attachToSharedDevServer)
- `src/bundler/bundle_v2.zig` — Sub-build machinery (collectSubBuilds, runSingleSubBuild, patchSubBuildExports)
- `src/bundler/BundleThread.zig` — JSBundleThread processing + cache check
- `src/bundler/SubBuildCache.zig` — VM-wide cache for cross-build dedup
- `src/bake/DevServer.zig` — Dev server standalone entry management
- `src/bake/DevServer/BundleGroup.zig` — Per-bundle group state tracking
- `src/bake/DevServer/IncrementalGraph.zig` — HMR bundle generation + takeJSBundle
- `src/bake/hmr-runtime-worker.ts` — Service worker HMR runtime (sync IIFE, no WebSocket)
- `src/import_record.zig` — BundleImportConfig struct (the import attributes)
