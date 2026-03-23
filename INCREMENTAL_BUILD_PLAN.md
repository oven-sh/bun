# Plan: Extract Incremental Build + HMR from DevServer into `Bun.build()` API

## Context

Bun's DevServer (`src/bake/DevServer.zig`) contains a powerful incremental compilation engine with HMR WebSocket support, but it's only accessible through the fullstack HTML import + `Bun.serve()` pattern. The `Bun.build()` JS API is one-shot only — no watch mode, no incremental builds, no HMR. This limits users who need custom server-side logic (auth, SSR) alongside HMR.

The goal: expose the incremental engine through `Bun.build()` so users can do:
```js
const bundle = await Bun.build({
  entrypoints: ["./src/frontend.tsx"],
  watch: true,    // enables incremental mode
  hmr: true,      // enables HMR WebSocket + React Fast Refresh
  target: "browser",
  // ... other existing options
});

bundle.files        // current output files
bundle.hmrEndpoint  // "/_bun/hmr" — attach to your own server
bundle.on("rebuild", (result) => { ... })
bundle.stop()
```

Additionally, fix the `isReactRefreshBoundary` getter bug that prevents React Fast Refresh from working on ESM modules.

## Approach: Two PRs

### PR 1: Fix `isReactRefreshBoundary` getter check (small, standalone)

**File:** `src/bake/hmr-module.ts` lines 909-934

The `isReactRefreshBoundary` function returns `false` for any module whose exports have getter descriptors. Since Bun's bundler uses getters for ALL ESM live bindings, no component module ever self-accepts via `reactRefreshAccept()`.

**Fix:** Instead of bailing on getters, invoke them safely and check the values:

```ts
// Before (line 923-927):
const desc = Object.getOwnPropertyDescriptor(esmExports, key);
if (desc && desc.get) {
  return false;
}
const exportValue = esmExports[key];

// After:
let exportValue;
try {
  exportValue = esmExports[key];
} catch {
  // Getter threw — not safe to treat as refresh boundary
  return false;
}
```

This preserves the safety intent (don't crash on side-effectful getters) while actually allowing ESM modules with getter-based exports to be checked. The `try/catch` handles the edge case where a getter genuinely has side effects that throw.

**Test:** `test/bake/dev/hot.test.ts` contains existing HMR tests. Verify existing tests pass, add a test that confirms component modules self-accept.

---

### PR 2: Add `watch` + `hmr` mode to `Bun.build()` (the main work)

This is structured as a series of commits, each independently testable.

#### Step 1: Add `watch: true` config parsing

**File:** `src/bun.js/api/JSBundler.zig`

- Add `watch: bool = false` to `Config` struct (line ~214, next to existing `hot: bool`)
- Parse it in `Config.fromJS()` — look for `"watch"` boolean property
- Add `hmr: bool = false` similarly

#### Step 2: Create `IncrementalBundleEngine` struct

**New file:** `src/bake/IncrementalBundleEngine.zig`

This struct extracts the core incremental compilation concerns from DevServer, without framework routing, SSR, or HTTP serving:

```
IncremenalBundleEngine {
    // From DevServer — needed for incremental builds:
    allocation_scope: AllocationScope,
    root: []const u8,
    graph_safety_lock: bun.safety.ThreadLock,
    client_graph: IncrementalGraph(.client),    // @fieldParentPointer target
    assets: Assets,                              // @fieldParentPointer target
    source_maps: SourceMapStore,                 // @fieldParentPointer target
    incremental_result: IncrementalResult,
    bundling_failures: ...,

    // Transpiler (single, client-only — no SSR):
    client_transpiler: Transpiler,

    // Watching:
    bun_watcher: *bun.Watcher,
    watcher_atomics: WatcherAtomics,
    directory_watchers: DirectoryWatchStore,      // @fieldParentPointer target

    // Bundle lifecycle (from DevServer.current_bundle / next_bundle):
    current_bundle: ?CurrentBundle,
    next_bundle: NextBundle,

    // JS callback integration:
    vm: *VirtualMachine,
    on_rebuild_callback: jsc.Strong.Optional,     // JS function to call on rebuild

    // HMR (optional):
    hmr_enabled: bool,
    // ... HMR WebSocket state if needed
}
```

**Key design decision:** `IncrementalGraph` uses `@fieldParentPointer("client_graph", g)` to reach its owner. This means the graph MUST be embedded as a field named `"client_graph"` in whatever struct owns it. We have two options:

- **Option A (recommended):** Keep the field name `client_graph` in IncrementalBundleEngine. The `owner()` function in IncrementalGraph returns `*DevServer` hardcoded — change it to return `*anyopaque` and cast at each callsite. This is ugly but mechanical.

- **Option B:** Make `IncrementalGraph` comptime-generic over its owner type: `IncrementalGraph(side, Owner)`. This is cleaner but touches every instantiation of IncrementalGraph across the codebase.

**Recommended: Option A first** (get it working), then refactor to Option B as a cleanup.

For Option A, the `owner()` function changes from:
```zig
pub fn owner(g: *Self) *DevServer {
    return @alignCast(@fieldParentPtr(@tagName(side) ++ "_graph", g));
}
```
To returning a new interface type that both DevServer and IncrementalBundleEngine implement. In Zig this is done with a tagged union or vtable:

```zig
pub const GraphOwner = struct {
    allocator: fn(*GraphOwner) Allocator,
    dev_allocator: fn(*GraphOwner) DevAllocator,
    graph_safety_lock: *bun.safety.ThreadLock,
    incremental_result: *IncrementalResult,
    bundling_failures: *BundlingFailures,
    // ... other fields accessed through owner()
};
```

Actually, the cleanest Zig pattern is: **make IncrementalGraph generic over `Owner` type** at comptime. Both DevServer and IncrementalBundleEngine provide the same field names/interface:

```zig
pub fn IncrementalGraph(comptime side: bake.Side, comptime Owner: type) type {
    return struct {
        pub fn owner(g: *Self) *Owner {
            return @alignCast(@fieldParentPtr(@tagName(side) ++ "_graph", g));
        }
        // Owner must have: allocator(), dev_allocator(), graph_safety_lock,
        // incremental_result, bundling_failures, assets, source_maps, dump_dir
    };
}
```

DevServer changes: `client_graph: IncrementalGraph(.client, DevServer)` (was `IncrementalGraph(.client)`)
Engine: `client_graph: IncrementalGraph(.client, IncrementalBundleEngine)`

This is a **comptime duck-typing** approach — both Owner types just need the same field names/methods.

#### Step 3: Adapt `HotReloadEvent` and `WatcherAtomics`

These use explicit `owner: *DevServer` pointers (not `@fieldParentPointer`).

- Change `owner: *DevServer` to `owner: *IncrementalBundleEngine` in the engine path
- OR make them generic: `HotReloadEvent(Owner)` / `WatcherAtomics(Owner)`
- `WatcherAtomics` is trivial — only uses owner for `ev.owner.vm.event_loop.enqueueTaskConcurrent`
- `HotReloadEvent.processFileList` accesses many DevServer fields — needs an interface or generic

**Simplest approach:** Create a simplified `EngineHotReloadEvent` that doesn't need directory watchers, tailwind hacks, or server graph — just invalidates the client graph and starts a rebuild.

#### Step 4: Wire up `Bun.build({ watch: true })`

**File:** `src/bun.js/api/JSBundler.zig`

When `config.watch == true`:
1. Don't use the one-shot `JSBundleCompletionTask` path
2. Instead, create an `IncrementalBundleEngine`, do the initial build
3. Return a JS object (not a plain Promise) that represents the live bundle:
   - `.outputs` — current file list (updates on rebuild)
   - `.on("rebuild", callback)` — register rebuild listener
   - `.stop()` — tear down watcher and engine
   - `.hmr` — HMR WebSocket upgrade handler (if `hmr: true`)

**File:** `src/bundler/bundle_v2.zig`

Add a new path alongside `generateFromJavaScript` and `startFromBakeDevServer`:
- `startFromIncrementalEngine(engine: *IncrementalBundleEngine, entry_points)`
- Reuses the async BundleV2 path (`asynchronous = true`)
- On completion, calls `engine.finalizeBundle()` instead of `dev_server.finalizeBundle()`

#### Step 5: HMR WebSocket (if `hmr: true`)

Create a standalone HMR WebSocket handler that can be mounted on any `Bun.serve()` instance:

```js
const bundle = await Bun.build({ watch: true, hmr: true, ... });

Bun.serve({
  routes: {
    "/_bun/hmr": bundle.hmrHandler,  // WebSocket upgrade handler
    "/_bun/client/*": bundle.clientHandler,  // Serves HMR bundles
    // ... user's own routes
  }
});
```

This extracts `HmrSocket` logic but strips out framework-specific concerns (route tracking, testing batch events, inspector integration).

#### Step 6: Client runtime injection

When `hmr: true`, the bundled output needs to include:
- `hmr-runtime-client.ts` (WebSocket client)
- `hmr-module.ts` (the `import.meta.hot` API)
- React Fast Refresh transform + runtime

This is already handled by `BundleV2` when `bake_options` is set — the engine just needs to pass the right config.

---

## Files to modify

| File | Change |
|------|--------|
| `src/bake/hmr-module.ts:909-934` | Fix getter check in `isReactRefreshBoundary` |
| `src/bake/DevServer/IncrementalGraph.zig:2013-2014` | Generalize `owner()` return type |
| `src/bake/DevServer/IncrementalGraph.zig:2041-2058` | Update DevServer type imports |
| `src/bake/DevServer.zig:68-69` | Update IncrementalGraph instantiation |
| `src/bake/DevServer/HotReloadEvent.zig` | Generalize `owner` field type |
| `src/bake/DevServer/WatcherAtomics.zig` | Generalize event owner type |
| `src/bake/DevServer/Assets.zig` | Generalize `@fieldParentPointer` owner |
| `src/bake/DevServer/DirectoryWatchStore.zig` | Generalize `@fieldParentPointer` owner |
| `src/bake/DevServer/SourceMapStore.zig` | Generalize `@fieldParentPointer` owner |
| `src/bun.js/api/JSBundler.zig:211-268` | Add `watch`/`hmr` to Config |
| `src/bun.js/api/JSBundler.zig:439+` | Parse `watch`/`hmr` from JS |
| `src/bun.js/api/JSBundler.zig:1172-1212` | Branch on watch mode |
| `src/bundler/bundle_v2.zig` | Add engine completion path |
| **NEW:** `src/bake/IncrementalBundleEngine.zig` | The extracted engine |

## Verification

1. **PR 1 (getter fix):** Run `bun test test/bake/dev/hot.test.ts` — existing tests must pass. Verify component modules self-accept by adding a test that changes a component and checks state preservation.

2. **PR 2 (incremental build API):**
   - Build Bun from source: `bun run build` or `zig build`
   - Write a test script:
     ```js
     const bundle = await Bun.build({
       entrypoints: ["./test-entry.tsx"],
       watch: true,
       outdir: "./dist"
     });
     console.log(bundle.outputs); // should list files
     // Edit test-entry.tsx...
     bundle.on("rebuild", (result) => {
       console.log("Rebuilt!", result.outputs);
     });
     ```
   - Run existing bundler tests: `bun test test/bundler/`
   - Run existing bake tests: `bun test test/bake/`

## Execution order

1. **Start with PR 1** — the `isReactRefreshBoundary` fix. ~30 minutes. One file, one function, huge impact.
2. **Then PR 2 Step 1** — Config parsing. Mechanical, no risk.
3. **Then PR 2 Step 2** — The IncrementalBundleEngine struct + IncrementalGraph generalization. This is the core work.
4. **Then Steps 3-6** — Wire everything together.

Steps 2-3 are where most of the time goes. Steps 4-6 are integration work that builds on the foundation.
