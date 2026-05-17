# Phase-1 Inventory — Section G: runtime-bake-dev-server

Run: `2026-05-15-exhaustive` · Sub-agent: unsafe-surface-mapper-G · Section paths: `src/runtime/bake/`

## Totals

| metric | DevServer.rs | dev_server/ | DevServer/ | production.rs | bake_body.rs | FrameworkRouter.rs | TOTAL |
|---|---:|---:|---:|---:|---:|---:|---:|
| `unsafe { ... }` blocks | 177 | 62 | 31 | 18 | 3 | 7 | **298** |
| `unsafe fn` declarations | 14 | 2 | 4 | 0 | 0 | 3 | **23** |
| `unsafe impl Send/Sync` | 0 | 0 | 0 | 1 | 0 | 0 | **1** |
| `// SAFETY:` comments | 162 | 61 | 24 | 21 | 4 | 6 | **278** |
| `extern "C"` decls / `#[unsafe(no_mangle)]` exports | 13 / 1 | 0 / 0 | 0 / 0 | 9 / 4 | 0 / 0 | 0 / 0 | 22 / 5 |
| transmute | 0 | 0 | 0 | 0 | 1 (in comment) | 0 | **0 actual** |
| `assume_init` | 25 | 3 | 1 | 6 | 0 | 0 | **35** |
| `UnsafeCell` (decl + use) | 3 | 0 | 0 | 7 | 0 | 0 | **10** |
| `Pin::new_unchecked` | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| `Drop` impls | 1 | 1 | 1 (RouteBundle, intentional none-impl note + 1 SourceMapStore comment-only) | 1 | 1 | 0 | **5 actual** |
| `BackRef<_>` declarations / uses | 9 | 8 | 6 | 6 | 0 | 0 | **29** |
| `container_of` / `from_field_ptr!` sites | 4 | 3 | 3 | 0 | 0 | 0 | **10** |

Surface site count (blocks + unsafe fn + unsafe impl): **322** vs prior `295` (+27, ~+9 %). Growth tracks the active Zig→Rust port (DevServer.rs at 292 KB, dev_server/incremental_graph.rs at 84 KB).

Safety-comment coverage: **278 / 322 ≈ 86 %**. The 30 raw blocks lacking a within-6-line SAFETY note are mostly repeated `self.dev()` / `(*this).router…` accesses where the function-level contract documents the BackRef invariant once.

## Per-row table (one row per file / cluster of unsafe surface)

| file | kind | site_count | dominant_bucket | macro_generated | safety_quality | notes |
|---|---|---:|---|---|---|---|
| `src/runtime/bake/DevServer.rs` | DevServer struct + lifecycle, request handling, WS upgrade, FFI exports | 191 (177 blk + 14 fn) | 1 Aliasing-callback, 21 FFI-callback aliasing, 4 Provenance | source-direct (one `bun_event_loop::impl_timer_owner!` at line 472, one `bun_core::from_field_ptr!` style helper) | strong — every `(*ptr).field` raw deref carries an inline `// SAFETY:` referencing BackRef invariant or §Forbidden aliased-`&mut`; 6 macro-deferred SAFETY blocks share an upstream comment | EXP-WS-bake anchor: `WebSocketHandler` impl at line 1443 mirrors Section F's `*mut Self` callback shape — `on_open`/`on_message` reborrow `&mut *this`, `on_close` stays at the pointer level for the destroy-self path. `Drop for DevServer` (line 1072) is the most caller-fragile shape — see §async-Drop hazards. |
| `src/runtime/bake/dev_server/mod.rs` | DevServer field defs, HotReloadEvent::run, IncrementalResult, dispatch | 30 (29 blk + 1 fn) | 1 Aliasing-callback, 21 FFI | source-direct | strong — `HotReloadEvent::run` (line 656) carries the most explicit raw-ptr re-borrow contract in the section: `dev` and `event` are co-resident as raw pointers across re-entrant boundaries; `&mut *dev` is materialized only for the duration of one `process_file_list` call, never spanning a `recycle_event_from_dev_server` call | The `fn run(first: *mut HotReloadEvent)` body documents in two paragraphs why `&mut HotReloadEvent` would create aliasing UB with `&mut DevServer` (the event lives inside `dev.watcher_atomics.events[_]`). Watcher-thread side communicates via `WatcherAtomics`. |
| `src/runtime/bake/dev_server/incremental_graph.rs` | IncrementalGraph<SIDE> per-side bundle store | 23 (22 blk + 1 fn) | 1 Aliasing (`container_of` projection) | source-direct (`offset_of!` + `bun_core::container_of`) | strong | `unsafe fn owner(&mut self) -> *mut DevServer` (line 314) is the canonical "sibling-projection" pattern: returns `*mut`, NOT `&mut`, because forming `&mut DevServer` while `&mut self` is live would alias. Three safe wrappers (`dev_incremental_result`, `dev_bundling_failures`, `dev_dump_dir`) project to disjoint sibling fields. |
| `src/runtime/bake/dev_server/assets.rs` | StaticRoute refcount table | 5 | 1 Aliasing (sibling `client_graph` access via `(*owner)`) | source-direct | strong — every block names invariant ("intrusively-refcounted StaticRoute we hold one ref to") | `Drop for Assets` (line 269) iterates `self.files.values()` to deref each `StaticRoute`. No async/IO inside Drop. |
| `src/runtime/bake/dev_server/source_map_store.rs` | source-map weak-ref sweep timer + entry storage | 4 | 1 Aliasing | source-direct | strong | `Drop for SourceMapStore` removed (per file-level header: "Zig spec asserted ref_count == 0; Rust port enforces via debug_assert in DevServer::Drop instead"). |
| `src/runtime/bake/dev_server/route_bundle.rs` | RouteBundle data + cached_response/client_bundle slots | 2 | 4 Provenance | source-direct (`BackRef` for `Arc<StaticRoute>`-shaped slots) | strong | Only 2 unsafe blocks; both are `Arc<StaticRoute>` deref through `BackRef`. Comment block at line 117-120 enumerates which `Option<BackRef<StaticRoute>>` slots Drop will visit. |
| `src/runtime/bake/DevServer/HmrSocket.rs` | HMR WebSocket per-connection state | 21 (20 blk + 1 fn) | 1 Aliasing-callback, 21 FFI re-entrant | source-direct (`bun_uws::web_socket::Wrap` trait impl) | strong — the function-level `unsafe fn dev<'a>(&self) -> &'a mut DevServer` (line 56) carries the exclusivity contract; per-call sites refer to it implicitly | 13 of 30 "no-SAFETY-within-6-lines" sites are repeated `self.dev()` calls — Phase 2 may want per-line restatement. `on_close` (line 354) takes `*mut HmrSocket` and ends with `drop(unsafe { bun_core::heap::take(s) })` — canonical destroy-self pattern matching Section F's pattern. |
| `src/runtime/bake/DevServer/WatcherAtomics.rs` | watcher-thread / DevServer-thread event triple-buffer | 5 | 22 Send/Sync (cross-thread `*mut HotReloadEvent` hand-off) | source-direct | strong — class-level doc enumerates the three event slots and exclusivity invariants per slot | The cross-thread protocol: `next_event: AtomicU8` (Acquire/Release/AcqRel), `current_event`/`pending_event` (watcher-thread-only fields). `swap` + CAS pair in `recycle_event_from_dev_server` (line 254-271) is the canonical `WAITING ↔ DONE` handoff. |
| `src/runtime/bake/DevServer/HotReloadEvent.rs` | HotReloadEvent struct alias declarations | 0 | — | — | — | All bodies live in `dev_server/mod.rs`; this file is just type-alias re-exports. |
| `src/runtime/bake/DevServer/DirectoryWatchStore.rs` | Phase-A draft dir-watch backing store for unresolved-import retry | 3 | 1 Aliasing (`from_field_ptr!` projection) | source-direct (`bun_core::from_field_ptr!`) | stale-draft hygiene — explicit `TODO(port): container_of aliasing — returning &mut DevServer while &mut self is live is unsound under stacked borrows; Phase B may need to return *mut DevServer or restructure access` | **EXP-028** originally flagged line 71, but Phase-5 source audit found the canonical `dev_server::DirectoryWatchStore` lives in `dev_server/mod.rs` and already uses `owner(&mut self) -> *mut DevServer`; no call sites of the draft type were found. |
| `src/runtime/bake/DevServer/ErrorReportRequest.rs` | error-report POST body assembler | 6 (3 blk + 3 fn) | 21 FFI-callback (uws on_data/on_error) | source-direct | strong | Three `unsafe fn` arms (`on_body`, `on_error`, `run_with_body`) follow uws callback shape; `*mut Self` receivers, no `&mut self` formed across the FFI dispatch frame. |
| `src/runtime/bake/DevServer/SourceMapStore.rs`, `Assets.rs`, `RouteBundle.rs`, `IncrementalGraph.rs`, `PackedMap.rs`, `SerializedFailure.rs`, `memory_cost.rs` | type-alias / sibling re-export shims for `dev_server/*.rs` modules | 0 | — | — | — | These files exist to keep the historical Zig naming (`DevServer/*.zig`) reachable from `DevServer/*.rs` while bodies live in `dev_server/*.rs`. Some carry only a `// PORT NOTE:` describing the Drop placement. |
| `src/runtime/bake/production.rs` | bun build --app prod path: ContextBuild, PerThread, dotenv singleton, bundling | 18 + 1 unsafe impl | 1 Aliasing, 4 Provenance, 22 Send/Sync (1) | source-direct | strong — only `unsafe impl Sync` in section is `DotenvSingleton` (line 74), which carries a 4-line invariant: "build_command runs single-threaded during CLI init; the singleton is set exactly once before any reader exists" | `Drop for PerThread` (line 1691) calls `BakeGlobalObject__attachPerThreadData(.., null)` to detach FFI binding before fields drop. No async hazard — runs in JS-thread shutdown. |
| `src/runtime/bake/bake_body.rs` | UserOptions config loader, plugin parsing | 3 | 1 Aliasing (arena lifetime erasure) | source-direct | strong — `arena_erase` (line 112) explicitly cites PORTING.md sanction and warns "do NOT generalize" | Self-referential pattern: `UserOptions` owns `arena: Arena` and `framework: Framework`-with-`'static` slices that actually borrow from the arena. `Drop for UserOptions` (line 152) only releases the FFI plugin handle; arena/allocations drop via field Drop in declared field order. |
| `src/runtime/bake/FrameworkRouter.rs` | FileSystemRouterType + Part lifetime juggling | 10 (7 blk + 3 fn) | 1 Aliasing (lifetime erasure) | source-direct | strong | `unsafe fn to_owned_part(self) -> Part<'static>` (line 1255) does variant-by-variant detach (no `transmute`). `unsafe fn d(s: &[u8]) -> &'static [u8]` is kept `unsafe fn` so callers re-state the arena-ownership contract. Only Phase-2-targetable surface is the Phase-A `'static` lifetime erasure here. |

## Bucket distribution (UB-TAXONOMY tags)

- **Bucket 1 (Aliasing — Stacked/Tree Borrows)**: dominant. ~85 % of G sites are raw `(*ptr).field` reads/writes routed through `*mut` to avoid forming `&mut T` across re-entrant FFI / JS-call / watcher-thread boundaries. `container_of`/`from_field_ptr!` sibling-projections (10 sites) are all explicitly tagged.
- **Bucket 4 (Provenance — `Box::from_raw`, casts)**: ~30 sites. Concentrated in `bun_core::heap::into_raw` / `heap::take` pairings inside `HmrSocket::new`/`on_close`, `on_websocket_upgrade`, `Box::into_raw(watcher)` in `Drop for DevServer`.
- **Bucket 6 (Validity — `MaybeUninit`)**: 35 `assume_init` sites — most in DevServer.rs `next_bundle.requests` intrusive-list nodes (`request.data.assume_init_mut()`).
- **Bucket 17 (async-Drop / runtime-block in Drop)**: see §async-Drop hazards. Bake has **no `async fn` and no `block_on` in Drop**, but `Drop for DevServer` performs synchronous FFI re-entry — not async-context but the analogue.
- **Bucket 21 (FFI callback aliasing — re-entrancy)**: ~25 sites in HmrSocket WS callbacks, ErrorReportRequest body callbacks, on_websocket_upgrade. Every one uses `*mut Self` receivers + short-lived reborrow.
- **Bucket 22 (Send/Sync confusion)**: 1 — `DotenvSingleton` (production.rs:74). Exhaustively justified.
- **Bucket Pin/self-ref**: 0 actual `Pin::new_unchecked` calls. The audit JSONL `pin_unchecked` tag at S-005476 was a false-positive (`NonNull::new_unchecked`, not `Pin`).

## Macro-generated vs source-direct

- **Source-direct unsafe**: ~99 % of G's surface — `unsafe { ... }` blocks written inline.
- **Macro-generated unsafe**:
  - `bun_event_loop::impl_timer_owner!(DevServer; from_timer_ptr => memory_visualizer_timer)` (DevServer.rs:472) — 1 invocation; emits `from_field_ptr!`-shape projection that recovers `*mut DevServer` from `*mut EventLoopTimer`.
  - `bun_core::from_field_ptr!` (DevServer/DirectoryWatchStore.rs:75, dev_server/incremental_graph.rs:320, +others) — `container_of` projection helpers.
  - `bun_uws_sys::web_socket::Wrap::<DevServer, HmrSocket, SSL>::apply` (DevServer.rs:1435) — generates the C-ABI `.WebSocketBehavior` with fn-ptr arms via the `WebSocketHandler` trait. Each arm is then a hand-written `unsafe fn` in `impl WebSocketHandler for HmrSocket` (line 1443).
- **NOT present in G**: no `bun_ptr::RefCounted` derive, no `impl_streaming_writer_parent!`, no `bun_sql_jsc::link_impl_*!` jump-table macro.

## Pin discipline audit — status: **N/A (zero Pin sites)**

`rg 'Pin' src/runtime/bake/` returns nothing other than a doc-comment "PORT NOTE" mentioning `Pin` in passing. Bake has no `Pin::new_unchecked`, no `Pin<&mut T>`, no `Pin<Box<T>>`, no `core::pin` import. The Phase-0 prior of "Pin" appears to have been a precaution rather than an anchored finding — bake is sync-only (no `async fn`, no `Future`) so address-stable self-referential state machines in the Pin sense don't arise. The self-referential UserOptions pattern in `bake_body.rs` is handled via lifetime erasure (`arena_erase`), not Pin.

## async-Drop hazard enumeration

Bake has **no `async fn`/`.await`/`Future` and no `block_on` paths anywhere**. The Phase-0 "async-drop" prior maps to the analogue: synchronous Drop bodies that perform side-effecting work (FFI calls, watcher-thread coordination, JSC handle release) while live concurrent state may still exist.

The five `Drop` impls in G:

1. **`Drop for DevServer`** (DevServer.rs:1072) — the most fragile. Three side-effecty steps:
   - **WS close cascade**: snapshots `active_websocket_connections` keys, calls `(*s).underlying.close()` which **synchronously dispatches `HmrSocket::on_close`** (uws guarantee), which calls back into `dev.active_websocket_connections.remove(s)` — re-entrant `&mut` on the very map being iterated, mitigated by the `Vec` key snapshot. Header comment at line 1083 names the invariant.
   - **Watcher hand-off**: `ManuallyDrop::take(&mut self.bun_watcher)` + `Watcher::shutdown(Box::into_raw(watcher), true)` — explicitly cited as a UAF-prevention measure: auto-dropping the `Box` would free the `ReadDirectoryChangesW` overlapped buffer out from under the still-running watcher thread on Windows. **Soundness depends on the Watcher thread eventually freeing the allocation in `thread_main` once `running` flips false.**
   - **Pre-crash handler removal**: `bun_crash_handler::remove_pre_crash_handler` — synchronous, no concurrent reader contract documented.
2. **`Drop for HmrSocket`** — implicit via `dev.active_websocket_connections.remove(s)` in `on_close`; no explicit Drop body. `on_close` itself frees self via `bun_core::heap::take(s)` — canonical destroy-self pattern.
3. **`Drop for Assets`** (dev_server/assets.rs:269) — iterates `self.files.values()` calling `StaticRoute::deref_(blob)`. No async/IO. Refcount-based; sound.
4. **`Drop for UserOptions`** (bake_body.rs:152) — calls `Plugin::destroy(p.as_ptr())` then field-drop order releases the arena. Sound.
5. **`Drop for PerThread`** (production.rs:1691) — calls `BakeGlobalObject__attachPerThreadData(global, null)` to detach FFI binding, then GC handle (`Strong`) drops via field. JS-thread-only contract; no concurrency hazard.

**Bucket 17 verdict for G**: no async-runtime block-in-Drop, but `Drop for DevServer` is a synchronous re-entrant cascade that warrants a Phase-2 LOOM/MIRI sweep over the WS-close ordering and Watcher hand-off. The watcher-thread-frees-the-Box pattern is documented but unproven against a concurrent kernel `ReadDirectoryChangesW` completion racing with Watcher's `running == false` check.

## HMR concurrency surface

- **Threads in scope**: (a) DevServer thread (= JS thread = sole `&mut DevServer` mutator outside `WatcherAtomics`), (b) Watcher thread (= dir-watch callback thread; sole writer of `current_event`/`pending_event` and sole producer into `events[i]`).
- **Sync mechanism**: `WatcherAtomics` in `DevServer/WatcherAtomics.rs`. Triple-buffer of `HotReloadEvent`s + `next_event: AtomicU8` (Acquire/Release/AcqRel) + watcher-thread-only `current_event`/`pending_event` indices. Class-level doc enumerates the three exclusivity slots.
- **Race surface**:
  1. `next_event.swap(ev_index, Ordering::AcqRel)` (line 171) → JS thread enqueues a `ConcurrentTask` only on the `DONE → ev_index` transition.
  2. `next_event.swap(WAITING.0, Ordering::AcqRel)` + `compare_exchange_weak(WAITING.0, DONE.0, Release, Relaxed)` (line 254-271) on JS-side recycle — terminates the loop only when no watcher event slipped in between.
  3. JS-thread-side `HotReloadEvent::run` (`dev_server/mod.rs:656`) re-borrows `*mut DevServer` per call, never holding `&mut DevServer` across `recycle_event_from_dev_server`.
- **Debug assertions**: `dbg_watcher_event` and `dbg_server_event` (cfg-gated) catch `acquire`/`release` ordering bugs in tests.
- **Other locks**: `graph_safety_lock: bun_safety::ThreadLock` is a debug-only thread-affinity assertion (release: zero-cost; debug: panics if a different thread enters the guarded region). It is NOT mutual exclusion — it's the assertion that the watcher thread never touches `client_graph`/`server_graph` directly. `dev_server::mod.rs:428` declares an additional `debug_mutex: bun_threading::Mutex` used only for `try_lock` debug-assertion checks across the `WatcherAtomics::watcher_acquire_event` / `recycle_event_from_dev_server` boundary.
- **WS dev-server channel**: HmrSocket re-entrant FFI shape mirrors Section F (ServerWebSocket) — `*mut Self` receivers in the trait impl, `&mut *this` reborrowed only inside the inherent body. No re-entrancy on `Drop for HmrSocket` (it's destroy-self in `on_close`).

## Top-3 concerning patterns

1. **`Drop for DevServer` synchronous WS-close cascade** (DevServer.rs:1072-1099). The `websocket.close()` re-enters `HmrSocket::on_close`, which mutates `dev.active_websocket_connections` and calls `bun_core::heap::take(s)` to free the socket. The current loop snapshots keys to a `Vec<*mut HmrSocket>` first, but pointer validity across a uws callback that runs synchronously on the same thread is the load-bearing invariant — Phase 2 should construct an EXP for whether uws re-entry can transitively schedule another `close()` on a still-iterating socket.
2. **EXP-028 — stale Phase-A `DirectoryWatchStore::owner(&mut self) -> &mut DevServer`** (DevServer/DirectoryWatchStore.rs:69-81). Self-flagged as "unsound under stacked borrows" via `TODO(port)`, but current canonical code in `dev_server/mod.rs` already uses raw parent recovery. No call sites of the draft type were found; do not count as current production UB.
3. **`Drop for DevServer` watcher hand-off via `ManuallyDrop::take` + `Box::into_raw`** (DevServer.rs:1117-1118). The Box is handed to `Watcher::shutdown(.., true)`, which signals the watcher thread to free the allocation in its own Drop. On Windows, the kernel's pending `ReadDirectoryChangesW` completion can race with the watcher's `running == false` exit check; the comment names the hazard but there is no per-platform proof that completions are drained before the watcher frees the Box. Loom or a real-watcher torture test would close this.

## Open questions

1. If the Phase-A draft modules remain compiled, should dead draft-only types like `directory_watch_store_body::DirectoryWatchStore` be removed or gated so stale unsafe shapes cannot be reintroduced by accident?
2. Does uws guarantee that the synchronous `HmrSocket::on_close` dispatched by `websocket.close()` cannot transitively `close()` a sibling socket? The DevServer Drop body assumes "no" via the up-front `keys().copied().collect::<Vec<_>>` snapshot; verify against uws.
3. Phase B `'static` lifetime erasure (bake_body.rs `arena_erase`, FrameworkRouter.rs `Part<'static>`) — could a re-entrant JS callback trigger `UserOptions::drop()` (and arena reset) while a `&'static [u8]` slice is still on the JS thread's stack? The Drop ordering must put arena last, but Phase B should thread `'bump` to make this typesystem-enforced.

---

**ported from / cross-ref**: Audit JSONL prior count = 295; current Phase-1 surface = 322 (+27, +9 %). Per-file line counts confirm the growth is organic Zig→Rust port progress (DevServer.rs/dev_server modularization happened post-audit).
