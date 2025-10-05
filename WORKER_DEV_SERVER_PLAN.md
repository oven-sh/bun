# Worker Support in Bake DevServer - Implementation Plan

## Overview

This document outlines the plan to add Web Worker support to Bake's development server. Workers in production builds already work correctly, but the dev server (`internal_bake_dev` format) currently has no worker support.

## Current State

### Production Build (✅ Working)
- Workers detected via `ImportKind.worker` and `E.NewWorker` AST nodes
- Workers bundled into separate chunks (e.g., `worker-axd28k5g.js`)
- Path resolution via `entry_point_chunk_indices` mapping
- Output: `new Worker("./worker-axd28k5g.js")`

### Dev Server (❌ Not Implemented)
- External dynamic imports (including workers) are **skipped** in `scanImportsAndExports.zig:660`
- No worker handling in HMR runtime (`hmr-module.ts`)
- No worker entry point detection in `IncrementalGraph.zig`
- Workers would fail because they can't use the HMR module system

## Implementation Strategy: Separate Entry Point Bundling

We'll treat workers as independent mini-bundles, similar to how routes are handled. Each worker gets:
- Its own bundle with the HMR runtime
- Independent HMR WebSocket connection (optional, can share with parent)
- Proper module resolution through the dev server

### Architecture

```
Main Page                    Worker
┌─────────────────┐         ┌──────────────────┐
│ HMR Runtime     │         │ HMR Runtime      │
│ Module Registry │         │ Module Registry  │
│                 │         │                  │
│ new Worker(url) │────────>│ Load & Execute   │
└─────────────────┘         └──────────────────┘
        │                            │
        │ WebSocket                  │ WebSocket (optional)
        ├────────────────────────────┤
        │      Dev Server            │
        └────────────────────────────┘
```

## Implementation Steps

### Phase 1: Detection and Entry Point Management

#### 1.1 Modify IncrementalGraph to Detect Workers
**File:** `src/bake/DevServer/IncrementalGraph.zig`

**Goal:** Treat worker imports as separate entry points, similar to dynamic imports.

**Changes needed:**
- In `processEdgeAttachment()`, detect `ImportKind.worker`
- Create a separate edge kind for workers (or reuse dynamic import logic)
- Mark worker files as entry points in the graph
- Store worker source indices for later bundling

**Key consideration:** Workers should be detected during the initial graph walk, not deferred.

#### 1.2 Create Worker Route Bundles
**File:** `src/bake/DevServer.zig`

**Goal:** Each worker gets its own `RouteBundle` for independent bundling.

**Changes needed:**
- Add a new bundle type or flag for workers (e.g., `RouteBundle.Kind.worker`)
- Register worker bundles in `route_bundles` array
- Create URL mapping: `/worker.js` → `/_bun/worker-[hash].js`

**URL scheme:**
```
Source: ./src/worker.js
Dev URL: /_bun/w/src/worker.js?v=[hash]
```

### Phase 2: Bundling and Code Generation

#### 2.1 Bundle Workers with HMR Runtime
**File:** `src/bake/DevServer/RouteBundle.zig` or equivalent bundling code

**Goal:** Generate standalone worker bundles with HMR support.

**Changes needed:**
- When bundling a worker entry point, include the HMR runtime
- Set `output_format = .internal_bake_dev`
- Mark as worker context (affects what globals are available)
- Generate with proper module wrapping

**Bundle structure:**
```javascript
// Worker bundle output
(function(hmr) {
  // HMR runtime for worker

  // Worker modules
  hmr.load("worker.js", function(module, exports, require) {
    // Worker code here
    self.onmessage = function(e) { ... }
  });

  // Execute entry
  hmr.loadExports("worker.js");
})(__createHMR());
```

#### 2.2 Update js_printer for Dev Mode Workers
**File:** `src/js_printer.zig`

**Goal:** Transform `new Worker()` calls in dev mode to use dev server URLs.

**Changes needed:**
- Detect when `module_type == .internal_bake_dev` in `e_new_worker` handler
- Instead of using unique keys, emit a call to an HMR helper
- Include the original worker path for dev server resolution

**Current (production):**
```javascript
new Worker("./worker-axd28k5g.js")
```

**Proposed (dev mode):**
```javascript
new Worker(__hmr__.resolveWorker("./worker.js"))
```

Or simpler (direct URL):
```javascript
new Worker("/_bun/w/worker.js?v=abc123")
```

### Phase 3: HMR Runtime Support

#### 3.1 Add Worker Helper to HMR Runtime
**File:** `src/bake/hmr-module.ts`

**Goal:** Provide helper method for creating workers in dev mode.

**Implementation:**
```typescript
export class HMRModule {
  // ... existing code ...

  /**
   * Creates a worker with dev server URL resolution
   * In dev mode, workers are bundled separately and served via dev server
   */
  static createWorker(specifier: Id, options?: WorkerOptions): Worker {
    // Resolve the specifier to a dev server URL
    // For now, just pass through - URL rewriting happens in js_printer
    return new Worker(specifier, options);
  }

  /**
   * Resolves a worker specifier to its dev server URL
   * Called from generated code if needed
   */
  static resolveWorker(specifier: string): string {
    // In development, workers are served from /_bun/w/[path]
    // The bundler will have already rewritten this
    return specifier;
  }
}
```

**Alternative simpler approach:** Don't add HMR methods, just rewrite URLs in js_printer directly.

### Phase 4: Dev Server Request Handling

#### 4.1 Serve Worker Bundles
**File:** `src/bake/DevServer.zig`

**Goal:** Handle HTTP requests for worker bundles.

**Changes needed:**
- Add route handler for `/_bun/w/*` pattern
- Map URL back to worker RouteBundle
- Serve bundled worker code
- Set proper CORS headers if needed
- Set `Content-Type: application/javascript`

**Request flow:**
```
1. Browser: GET /_bun/w/src/worker.js?v=abc123
2. DevServer: Lookup worker bundle for "src/worker.js"
3. DevServer: If not bundled, trigger bundle
4. DevServer: Return bundled worker code
```

#### 4.2 Handle Worker HMR Updates
**File:** `src/bake/DevServer/HmrSocket.zig` or HMR event handling

**Goal:** Hot-reload workers when their code changes.

**Options:**
1. **Simple:** Force page reload when worker code changes (like CSS currently does)
2. **Advanced:** Send HMR update to worker via `postMessage` bridge

**For initial implementation, use option 1 (page reload).**

### Phase 5: Don't Skip Workers in Scan Phase

#### 5.1 Update scanImportsAndExports
**File:** `src/bundler/linker_context/scanImportsAndExports.zig`

**Current code (line 659-660):**
```zig
if (!record.source_index.isValid() or this.isExternalDynamicImport(record, source_index)) {
    if (output_format == .internal_bake_dev) continue;  // <-- This skips workers!
```

**Goal:** Don't skip workers in dev mode, but handle them specially.

**Proposed change:**
```zig
if (!record.source_index.isValid() or this.isExternalDynamicImport(record, source_index)) {
    if (output_format == .internal_bake_dev) {
        // In dev mode, workers are handled as separate entry points
        // Don't skip them - they need to be registered
        if (record.kind == .worker) {
            // Mark as worker entry point for dev server
            // The dev server will bundle this separately
            // TODO: Add to worker entry points list
        }
        continue;
    }
```

## Detailed File Changes

### 1. `src/js_printer.zig` (lines ~2200-2242)

**Current:**
```zig
.e_new_worker => |e| {
    // ... wrapper code ...
    p.print("new Worker(");

    if (p.options.unique_key_prefix.len > 0) {
        // Production mode: use unique keys
        const import_record = p.importRecord(e.import_record_index);
        const source_index = import_record.source_index.get();
        const unique_key = std.fmt.allocPrint(p.options.allocator, "{s}W{d:0>8}", .{ p.options.unique_key_prefix, source_index }) catch unreachable;
        defer p.options.allocator.free(unique_key);
        p.printStringLiteralUTF8(unique_key, true);
    } else {
        // Fallback: direct path
        p.printStringLiteralUTF8(p.importRecord(e.import_record_index).path.text, true);
    }
    // ... rest
}
```

**Proposed:**
```zig
.e_new_worker => |e| {
    // ... wrapper code ...
    p.print("new Worker(");

    if (p.options.module_type == .internal_bake_dev) {
        // Dev mode: use dev server URL
        const import_record = p.importRecord(e.import_record_index);
        const worker_path = import_record.path.text;

        // Format: /_bun/w/[path]?v=[hash]
        // For now, just use the pretty path - dev server will resolve it
        p.printStringLiteralUTF8(worker_path, true);
    } else if (p.options.unique_key_prefix.len > 0) {
        // Production mode: use unique keys
        const import_record = p.importRecord(e.import_record_index);
        const source_index = import_record.source_index.get();
        const unique_key = std.fmt.allocPrint(p.options.allocator, "{s}W{d:0>8}", .{ p.options.unique_key_prefix, source_index }) catch unreachable;
        defer p.options.allocator.free(unique_key);
        p.printStringLiteralUTF8(unique_key, true);
    } else {
        // Fallback: direct path
        p.printStringLiteralUTF8(p.importRecord(e.import_record_index).path.text, true);
    }
    // ... rest
}
```

### 2. `src/bake/DevServer/IncrementalGraph.zig`

**Location:** In `processEdgeAttachment()` function

**Add after existing import kind handling:**
```zig
// Handle worker imports as separate entry points
if (import_record.kind == .worker) {
    // Workers need to be bundled as separate entry points
    // Mark this file as a worker entry point
    // The dev server will create a separate bundle for it

    // For now, treat similar to dynamic imports
    // but mark as worker kind for special handling
    log("Worker import detected: {s} -> {s}", .{
        key,
        ctx.parse_graph.input_files.items(.source)[import_record.source_index.get()].path.pretty
    });

    // TODO: Register worker entry point
    // This will be picked up by the bundler to create a separate worker bundle
}
```

### 3. `src/bake/DevServer.zig`

**Add worker bundle management:**
```zig
// Add to DevServer struct
/// Map from worker source index to bundle index
worker_bundles: std.AutoHashMapUnmanaged(IncrementalGraph(.server).FileIndex, usize) = .{},

// Add helper method
pub fn getOrCreateWorkerBundle(
    this: *DevServer,
    worker_source_index: IncrementalGraph(.server).FileIndex,
) !*RouteBundle {
    // Check if worker bundle already exists
    if (this.worker_bundles.get(worker_source_index)) |bundle_index| {
        return &this.route_bundles.items[bundle_index];
    }

    // Create new worker bundle
    const bundle_index = this.route_bundles.items.len;
    try this.route_bundles.append(this.allocator(), RouteBundle{
        // TODO: Initialize worker bundle
        .kind = .worker,
        .entry_point = worker_source_index,
        // ... other fields
    });

    try this.worker_bundles.put(this.allocator(), worker_source_index, bundle_index);
    return &this.route_bundles.items[bundle_index];
}
```

## Testing Plan

### Test 1: Basic Worker in Dev Mode
```javascript
// main.js
const worker = new Worker('./worker.js');
worker.postMessage('hello');

// worker.js
self.onmessage = (e) => {
  console.log('Worker received:', e.data);
  self.postMessage('world');
};
```

**Expected:**
- Dev server bundles worker.js separately
- Worker loads and executes
- Messages work bidirectionally
- No console errors

### Test 2: Worker with Dependencies
```javascript
// worker.js
import { helper } from './helper.js';
self.onmessage = (e) => {
  self.postMessage(helper(e.data));
};

// helper.js
export function helper(x) { return x * 2; }
```

**Expected:**
- Worker bundle includes helper.js
- Module resolution works in worker context
- Helper function executes correctly

### Test 3: Worker HMR (Simple)
```javascript
// worker.js
self.onmessage = (e) => {
  self.postMessage('v1');
};

// Edit to:
self.onmessage = (e) => {
  self.postMessage('v2');
};
```

**Expected (initial implementation):**
- Page reloads when worker code changes
- Worker uses new code after reload

**Expected (future):**
- Worker hot-reloads without page reload
- New worker code executes
- Existing worker terminates gracefully

## Future Enhancements

### 1. True Worker HMR
- Workers can hot-reload without terminating
- Use `postMessage` bridge to notify worker of updates
- Worker can accept/reject updates like modules

### 2. Shared Workers
- Support `new SharedWorker()`
- Multiple pages can share worker instances
- Coordinate HMR across all connected pages

### 3. Service Workers
- Support `navigator.serviceWorker.register()`
- Special handling for service worker lifecycle
- Mock service worker APIs in dev mode

### 4. Worker Module Type
- Support `new Worker(url, { type: 'module' })`
- Native ES module workers
- Different bundling strategy for module workers

## Success Criteria

Phase 1 complete when:
- [x] Production worker bundling works (DONE)
- [ ] Workers detected as entry points in dev server
- [ ] Worker bundles created and served
- [ ] Basic test case works in dev mode
- [ ] No regressions in production builds

Full implementation complete when:
- [ ] All test cases pass
- [ ] HMR triggers page reload on worker changes
- [ ] Documentation updated
- [ ] Edge cases handled (worker errors, missing files, etc.)

## Open Questions

1. **Worker HMR WebSocket**: Should workers have their own WebSocket connection, or communicate via `postMessage` with the parent page?
   - **Answer:** Start simple - parent page relays HMR events via postMessage if needed. For initial version, just reload page.

2. **Worker URL scheme**: What URL pattern should we use for workers in dev mode?
   - **Proposal:** `/_bun/w/[relative-path]?v=[hash]`
   - Alternative: `/__worker/[hash].js`

3. **Worker-specific globals**: How do we handle worker-only globals (`self`, `importScripts`)?
   - **Answer:** Workers bundle with appropriate target context. The HMR runtime should detect worker context.

4. **Module vs Classic workers**: Should we support both?
   - **Answer:** Start with classic workers (default). Module workers can be added later.

## Dependencies

This implementation depends on:
- Existing production worker bundling (DONE)
- Existing HMR infrastructure
- Existing IncrementalGraph system
- No external dependencies needed

## Timeline Estimate

- **Phase 1 (Detection & Entry Points):** 2-4 hours
- **Phase 2 (Bundling & Code Gen):** 3-5 hours
- **Phase 3 (HMR Runtime):** 1-2 hours
- **Phase 4 (Request Handling):** 2-3 hours
- **Phase 5 (Scan Phase Fix):** 1 hour
- **Testing & Debug:** 3-4 hours

**Total:** ~12-19 hours of focused development

## Notes

- Start with the simplest possible implementation (page reload on worker change)
- Ensure production builds continue to work perfectly
- Test frequently with real examples
- Document as we go
