# Unified Build Vision: Imports as the Universal Build Primitive

## Core Idea

Replace specialized build systems (HTMLBundle, JSBundle, DevServer, `bun --hot`) with a
single model centered on **imports**. The import graph IS the build graph. Sub-builds are
just sub-graphs triggered by import attributes. The bundler, runtime, and dev server
become aspects of one system rather than separate systems.

---

## Execution Model

### What Runs When

There are three execution contexts today:

| Context | What happens |
|---------|-------------|
| `bun build` / `bun build --compile` | Static bundling. Code is parsed but NOT executed (except macros). Output goes to `--outdir` or embedded in binary. |
| `bun run server.ts` | JIT transpilation. Files are transpiled on-demand as they're imported. All module-level code executes. |
| `bun --hot server.ts` | Same as `bun run` but with a file watcher. On file change, currently nukes all module caches and re-executes everything from scratch. |

### The Proposal

In all three contexts, an **incremental builder** runs from the start. It:
- Tracks the full dependency graph (who imports whom)
- Caches transpiled/bundled output in memory
- On file change, marks only affected files as stale and re-processes them

For `bun build`, the incremental builder runs once and exits.
For `bun run` / `bun --hot`, it stays alive and watches for changes.

Sub-builds triggered by `with { type: "bundle" }` are additional entry points in the
same incremental system. They share the graph, share the cache, and their outputs are
available immediately as metadata + lazy content handles.

---

## Import-Driven Builds

### `with { type: "bundle" }` as a Build Primitive

```ts
import app from "./App.tsx" with { type: "bundle", splitting: "true" }
```

This tells the bundler: "build App.tsx as a separate sub-graph targeting the browser."
The import resolves to an object with:

```ts
interface BundleResult {
  /** All output files from the build */
  files: BundleFile[]
  /** The entry point file (includes HMR bootstrap in dev mode) */
  entrypoint: BundleFile
}

interface BundleFile {
  name: string              // "index.js", "chunk-abc.js", "index.js.map"
  kind: "entry-point" | "chunk" | "asset" | "sourcemap"
  type: string              // MIME type
  size: number
  file(): Blob              // Lazy content access
}
```

The build happens **eagerly when the import is evaluated**:
- During `bun build --compile`: at compile time, outputs embedded in binary
- During `bun run`: at module load time, outputs held in memory
- In dev mode: initial build at load time, incremental rebuilds on file change

`BundleFile.file()` returns a `Blob` whose backing depends on context:
- In `--compile` mode: reads from embedded data in the executable
- In `bun run` mode: reads from in-memory cache
- After `bun build --outdir`: reads from disk

### Build-Time Side Effects via Macros

For things that must happen during the build (e.g., uploading sourcemaps to Datadog),
use a macro wrapper. The macro file calls `Bun.build()`, performs side effects, and
returns the result. Both the build and the side effects happen at compile time.

```ts
// app-bundle.ts — macro that builds the app and uploads sourcemaps
export default async function() {
  const app = await Bun.build({
    entrypoints: ["./App.tsx"],
    splitting: true,
    sourcemap: "external",
  })

  if (Bun.env.DD_API_KEY) {
    for (const f of app.outputs) {
      if (f.kind === "sourcemap") {
        await fetch(`https://sourcemaps.datadoghq.com/v1/input/${Bun.env.DD_API_KEY}`, {
          method: "POST",
          body: JSON.stringify({
            service: "my-app",
            version: Bun.env.GIT_SHA,
            source_map: await f.text(),
          }),
        })
      }
    }
  }

  return app
}
```

Import as a macro from any file — the build runs once (memoized), result is shared:

```ts
import app from "./app-bundle.ts" with { type: "macro" }
```

---

## Cross-Bundle References

Bundles can reference each other's outputs. Import the same macro from multiple files —
the build runs once, everyone gets the same result.

```ts
// app-bundle.ts — builds the app, uploads sourcemaps
export default async function() {
  const app = await Bun.build({ entrypoints: ["./App.tsx"], splitting: true, sourcemap: "external" })
  // ... upload sourcemaps ...
  return app
}

// sw.ts — service worker references the app's file manifest
import app from "./app-bundle.ts" with { type: "macro" }

const CACHE_URLS = app.outputs
  .filter(f => f.kind !== "sourcemap")
  .map(f => `/assets/${f.name}`)

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("v1").then(c => c.addAll(CACHE_URLS)))
})

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})

// server.ts — serves everything
import app from "./app-bundle.ts" with { type: "macro" }
import sw from "./sw.ts" with { type: "bundle", target: "worker" }

export default {
  port: 3000,
  routes: {
    "/": new Response(`<!DOCTYPE html>
      <html>
        <head><script type="module" src="/assets/${app.entrypoint.name}"></script></head>
        <body><div id="root"></div></body>
      </html>`, { headers: { "content-type": "text/html" } }),

    "/sw.js": sw.entrypoint.file(),

    ...Object.fromEntries(
      app.outputs
        .filter(f => f.kind !== "sourcemap")
        .map(f => [`/assets/${f.name}`, f.file()])
    ),
  },
}
```

The bundler resolves bottom-up:
1. Build App.tsx → produces file list, uploads sourcemaps
2. Build sw.ts → imports app macro, inlines the file list as constants for cache manifest
3. Build server.ts → has both bundles' outputs, serves them

---

## Serving

User code is **identical between dev and production**:

```ts
import app from "./app-bundle.ts" with { type: "macro" }

export default {
  port: 3000,
  routes: {
    "/": new Response(`<!DOCTYPE html>
      <html>
        <head><script type="module" src="/assets/${app.entrypoint.name}"></script></head>
        <body><div id="root"></div></body>
      </html>`, { headers: { "content-type": "text/html" } }),

    ...Object.fromEntries(
      app.outputs
        .filter(f => f.kind !== "sourcemap")
        .map(f => [`/assets/${f.name}`, f.file()])
    ),
  },
}
```

In dev mode:
- `app.entrypoint` contains the HMR bootstrap code (websocket connection + HMR runtime)
  concatenated with the full app in a single chunk
- `app.files` has just the one entry — iterating it produces one route
- The browser loads the entrypoint, which auto-connects to Bun's HMR websocket

In production:
- `app.entrypoint` is the normal entry point bundle
- `app.files` has the entrypoint + split chunks + assets
- Same iteration, more files, no HMR code

The user never writes different code for dev vs prod. The bundle result adapts.

---

## HMR / Hot Reload

### Current State

- **Frontend HMR** (`src/bake/hmr-module.ts`): Full granular HMR with `import.meta.hot`,
  accept/dispose/data, importer tracking, boundary propagation. Only works in the browser
  via DevServer.
- **Backend `--hot`**: Nukes all module caches and re-executes everything from scratch.
  No `import.meta.hot`. Users manually stash state in `globalThis`.

### The Proposal

#### Bun-Managed HMR WebSocket

When `bun --hot server.ts` starts, Bun opens an **internal HMR websocket** on an
auto-assigned port (separate from the user's server). This socket:

- Serves the initial frontend bundle on first browser connection
- Pushes changed modules to connected browsers on file change
- Is completely invisible to the user — no route registration needed

The entrypoint chunk includes a small bootstrap that auto-connects:
```js
// Injected into app.entrypoint in dev mode
const ws = new WebSocket(`ws://localhost:${__BUN_HMR_PORT__}/hmr`);
ws.onmessage = (e) => replaceModules(JSON.parse(e.data));
```

#### HMR Transforms

When `--hot` is active, the transpiler wraps every module with an `HMRModule` instance.
The transforms are the same for backend and frontend:

| Original code | Transformed to |
|---|---|
| `export function Foo() {}` | `hmr.exports = { Foo }` |
| `import { x } from "./dep"` | Resolved through `hmr.require("./dep")` |
| `import.meta.hot.data` | `hmr.data` |
| `import.meta.hot.accept()` | `hmr.accept()` |
| `import.meta.hot.dispose(cb)` | `hmr.dispose(cb)` |

Which bundles get HMR transforms:

| Bundle | HMR transformed? | Why |
|---|---|---|
| Backend (server.ts + deps) | Yes | Running directly under `--hot` |
| Frontend (App.tsx + deps) | Yes | Browser target, connected via websocket |
| Service worker (sw.ts) | No | Workers can't do HMR |

#### Backend HMR

Backend modules get the same `HMRModule` wrapper. Updates propagate in-process (no
websocket needed — it's the same runtime). The `import.meta.hot` API is available:

- **`import.meta.hot.data`** — persistent state across reloads. Writing to `data`
  implicitly self-accepts the module.
- **`import.meta.hot.accept()`** — explicitly mark this module as an HMR boundary
- **`import.meta.hot.dispose(cb)`** — cleanup before re-execution

```ts
// server.ts — server preserved across reloads via hot.data
import app from "./app-bundle.ts" with { type: "macro" }

const server = import.meta.hot?.data?.server ?? Bun.serve({
  port: 3000,
  routes: {
    ...Object.fromEntries(app.outputs.map(f => [`/assets/${f.name}`, f.file()])),
  },
  fetch(req) { return new Response("hello") }
})

if (import.meta.hot) {
  import.meta.hot.data.server = server
}
```

#### Frontend HMR

Frontend bundles get the same HMR transforms plus the websocket bootstrap in the
entrypoint. When a file changes:

1. Incremental builder re-bundles the changed file
2. New module code is pushed over the HMR websocket
3. Browser-side `replaceModules()` patches the module in place
4. Update propagates through the importer graph to HMR boundaries

Framework-specific plugins (like React Fast Refresh) can be layered on top. The core HMR
system works without them — components still update, but framework-level state (e.g.,
React component state) may be lost without the plugin.

#### On File Change

A single file change can affect both backend and frontend:

1. File watcher detects change to `utils.ts`
2. Incremental builder marks `utils.ts` stale, re-bundles it
3. Walk dependency edges to find all affected modules
4. **Backend**: if `utils.ts` is in the server graph, propagate through backend
   HMRModule importers. Re-execute accepting modules in-process.
5. **Frontend**: if `utils.ts` is in a browser bundle graph, push the updated module
   over the HMR websocket. Browser-side `replaceModules()` handles patching.

Same incremental builder, same change event, two consumers.

---

## The Incremental Builder

### Architecture

The incremental builder is a layer on top of BundleV2 (the existing one-shot bundler):

| Component | Role |
|-----------|------|
| **BundleV2** | Actual parse → link → output work (unchanged) |
| **IncrementalGraph** | Persistent storage of bundled code, bidirectional dependency edges, stale file tracking |
| **File Watcher** | Detects file changes, marks files as stale in the graph |
| **Module Wrapper** | HMRModule wrapping for granular re-execution |

The IncrementalGraph already exists in `src/bake/DevServer/IncrementalGraph.zig` but is
currently tied to DevServer. The plan is to extract it into a general-purpose engine that
can be used by:
- `bun run` / `bun --hot` (backend module tracking + frontend sub-builds)
- `Bun.build({ watch: true })` (programmatic incremental builds)
- `Bun.serve()` in dev mode (replaces current per-bundle DevServer creation)

### Cost of Always-On

For a long-running process (`bun run`), the overhead is minimal:
- ~5-20MB for the dependency graph and cached output
- Transpiled code is already cached in memory (SourceProvider cache)
- The incremental graph just adds dependency tracking on top

For one-shot `bun build`, the graph is discarded after the build completes. No
meaningful overhead since the process exits.

---

## What This Replaces

| Current System | Replaced By |
|---------------|-------------|
| `JSBundle` class + Route | `with { type: "bundle" }` / macro returning BundleResult |
| `HTMLBundle` class + Route | Bundle + HTML template |
| Per-bundle DevServer creation | Shared incremental builder from the root |
| `bun --hot` nuke-and-restart | Granular HMRModule re-execution |
| `globalThis.server` workaround | `import.meta.hot.data` |
| Specialized `Bun.serve()` route types | Plain files/blobs passed to routes |
| Separate frontend/backend HMR systems | One incremental builder, two consumers |
| Manual HMR route registration | Bun-managed internal HMR websocket |

---

## Open Questions

1. **Macro return types**: Can macros return `BuildArtifact` objects with lazy `file()`
   handles? Currently limited to JSON-serializable + Blob/Response. May need extension.

2. **Bundle memoization**: If two files import the same macro, the build should run once.
   Current macro system caches the VM but not execution results — needs memoization by
   entry point + config hash.

3. **`with {}` limitation**: Import attributes only allow string values (TC39 spec).
   Complex config (arrays, objects) must go inside the macro function.

4. **Circular bundle imports**: User error. Bundler should detect and error.

5. **Dev mode `bundle.files`**: In dev mode, there's one chunk (entrypoint with HMR
   bootstrap + full app). Splitting doesn't apply in dev. This is consistent.

6. **Server lifecycle**: Should Bun automatically preserve `Bun.serve()` across hot
   reloads, or require explicit `import.meta.hot.data`? Automatic is better UX but may
   surprise users with stateful servers.

7. **`with { type: "compile" }` (future)**: A potential import attribute that means
   "execute this module during bundling" — like macros but for whole modules instead of
   exported functions. Would eliminate the need for the macro function wrapper pattern.
