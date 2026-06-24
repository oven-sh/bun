# Section G: runtime-bake-dev-server

## Purpose

`src/runtime/bake/` is Bun's Bake framework — the SSR/dev-server stack that powers `bun run` HMR development and `bun build --app` production bundling. It owns:

- The HTTP/WebSocket dev server (`DevServer.rs` — 292 KB, the largest single Rust file in the repo).
- The hot-module-reload pipeline: file-watcher → `WatcherAtomics` triple-buffer → `HotReloadEvent::run` on the JS thread → incremental graph rebuild → `HmrSocket` push to subscribed browsers.
- The incremental graph (`dev_server/incremental_graph.rs`, 84 KB) — per-side (Client / Server) bundle-state store.
- The production build path (`production.rs`) — single-shot full-app prerender + CDN-asset emit.
- User config loading (`bake_body.rs`) — self-referential `UserOptions { arena, framework with 'static slices borrowing arena }`.
- Filesystem-router pattern matching (`FrameworkRouter.rs`).

It is the **second-largest section in the run** by source bytes, and structurally one of the most concurrency-coupled (file-watcher thread interleaved with the JS thread).

## Unsafe-surface tally (vs prior 295)

- **322 surface sites** = 298 `unsafe { ... }` blocks + 23 `unsafe fn` decls + 1 `unsafe impl Sync`.
- Prior audit: 295. Delta: **+27 (+9 %)**, attributable to ongoing port progress (DevServer.rs and dev_server/* split landed post-audit).
- SAFETY-comment coverage: **278/322 = 86 %**. Uneven by file: WatcherAtomics 100 %, dev_server/mod.rs 90 %, HmrSocket ~57 % (where 13 of the 30 "missing" are repeated `self.dev()` calls covered by the function-level contract on `unsafe fn dev<'a>(&self) -> &'a mut DevServer`).
- Densest cluster: `DevServer.rs` (191 sites in 6646 lines, ~1 unsafe per 35 LOC).
- Macro generation: ~99 % source-direct. Three small macros (`impl_timer_owner!`, `from_field_ptr!`, `web_socket::Wrap::apply`) account for the rest.

## Pin discipline audit

**Status: not applicable.**

`rg 'Pin' src/runtime/bake/` returns one comment hit and zero source uses. Bake has:

- 0 `Pin::new_unchecked` calls
- 0 `Pin<&mut T>` / `Pin<Box<T>>` declarations
- 0 `core::pin` imports
- 0 `async fn` / `.await` / `Future` impls
- 0 self-referential state-machine futures

The Phase-0 prior of "Pin" was a precaution, not an anchored finding. The audit JSONL `pin_unchecked` tag at S-005476 was a regex false-positive against `NonNull::new_unchecked` (DevServer.rs:2178).

The one self-referential pattern in G is `UserOptions { arena: Arena, framework: Framework /* with 'static slices into arena */ }` (`bake_body.rs:142-150`). It is handled via lifetime erasure (`arena_erase` at line 112), with explicit PORTING.md sanction. The Drop order — `bundler_options` first, then `framework`, then `allocations`, then `arena` last — is load-bearing. **Phase B target**: thread `'bump` lifetime to remove the `'static` lie.

## async-Drop hazard enumeration

Bake has **no async-runtime or `block_on` paths anywhere**. The Bucket-17 analogue — synchronous Drop bodies that perform side-effecting work concurrent with other threads — has 5 enumerated impls:

| impl Drop | location | concurrent state at Drop time | hazard |
|---|---|---|---|
| `DevServer` | DevServer.rs:1072 | watcher thread still alive; uws sockets still registered; pre-crash handler installed | **HIGHEST** — see Top-3 #1 and #3 |
| `Assets` | dev_server/assets.rs:269 | none (single-threaded refcount release) | none |
| `UserOptions` | bake_body.rs:152 | none (CLI init, single-threaded) | arena Drop ordering — see Phase B |
| `PerThread` | production.rs:1691 | JS thread shutdown; no concurrent reader | FFI detach order is correct (`attachPerThreadData(null)` before field drop) |
| `HmrSocket` | (no explicit impl; destroy-self in `on_close`) | uws callback; sole owner of `*mut Self` | none — canonical destroy-self |

The pre-crash handler removal in `DevServer::drop` is also notable: it deregisters the global `Output::on_handler_for_crash` slot. If the process crashes between `remove_pre_crash_handler` and the actual `Box<DevServer>` deallocation, the partially-deinit'd DevServer would still be heap-resident but unreachable from the crash dump. Low priority but worth noting.

## HMR concurrency surface

### Threads

1. **DevServer thread** (= JS thread). Sole `&mut DevServer` mutator outside `WatcherAtomics`. Sole reader/writer of `client_graph`, `server_graph`, `bundling_failures`, `incremental_result`, `route_bundles`, `active_websocket_connections`, `source_maps`.
2. **Watcher thread**. Spawned by `bun_watcher::Watcher::shutdown(_, false)` (in init). Owns `current_event` + `pending_event` indices in `WatcherAtomics`; produces into `events[i]` (one of three slots) in exclusive mode per the slot-availability table.
3. (No worker pool — bake runs its own bundling on the JS thread.)

### Sync primitives

| primitive | location | role | atomicity |
|---|---|---|---|
| `next_event: AtomicU8` | `WatcherAtomics.rs:27` | one-byte channel between watcher and DevServer threads encoding (a) "no event" (DONE), (b) "event running" (WAITING), or (c) "next event index" (0..3) | swap AcqRel; load Acquire; CAS Release/Relaxed |
| `current_event: Option<u8>` | `WatcherAtomics.rs:32` | watcher-thread-only; tracks which slot is being processed by DevServer | non-atomic, watcher-thread exclusive |
| `pending_event: Option<u8>` | `WatcherAtomics.rs:33` | watcher-thread-only; tracks the second slot the watcher has filled | non-atomic, watcher-thread exclusive |
| `contention_indicator: AtomicU32` | `dev_server/mod.rs:426` | per-event hazard flag; set by JS thread on entry, checked by Watcher thread to detect "JS still processing this event" | seq_cst |
| `debug_mutex: bun_threading::Mutex` | `dev_server/mod.rs:428` | debug-build-only `try_lock` assertions to catch acquire/release ordering bugs | mutex (debug only) |
| `graph_safety_lock: bun_safety::ThreadLock` | `DevServer.rs:353` | debug-build-only thread-affinity assertion (panics if a non-DevServer thread enters guarded code) | release: zero-cost |

**Crucially**, `graph_safety_lock` and `debug_mutex` are NOT mutual exclusion — they are debug-build-only assertions. The actual cross-thread coordination is the `WatcherAtomics` AtomicU8 channel + the structural invariant that the watcher thread never touches anything except `WatcherAtomics::events[i]` (where `i ∉ {current_event, pending_event}`).

### Race surface

Three protocol transitions, all in `WatcherAtomics`:

1. **Watcher submits event** (`watcher_release_and_submit_event`, line 128):
   - `swap(ev_index, AcqRel)` — publishes the event to the JS thread.
   - On `DONE` return: schedules a `ConcurrentTask` via `event_loop.enqueue_task_concurrent`. The `concurrent_task` is constructed with the event ptr; **the JS event loop's queue is the thread-safe handoff**.
   - On `WAITING` return: bumps `pending_event` slot.
2. **JS recycles event** (`recycle_event_from_dev_server`, line 232):
   - `swap(WAITING, AcqRel)` to claim "another event might come in"
   - If `WAITING` was already there: CAS to `DONE` to terminate
   - If a new index slipped in: continue loop
3. **JS run-loop** (`HotReloadEvent::run`, `dev_server/mod.rs:656`):
   - Materializes `&mut *dev` only inside one `process_file_list` call
   - Re-borrows `*mut HotReloadEvent → next event` per iteration
   - Never holds two `&mut`s simultaneously

The protocol is well-documented and matches the Zig spec. Loom (Phase 2) is the right tool to validate the ordering against weakly-ordered architectures.

### WebSocket dev-server channel

`HmrSocket` is the per-connection state. Lifecycle:

```
on_websocket_upgrade(*mut DevServer, *mut Response<SSL>, &mut Request, &mut WebSocketUpgradeContext, id)
  → bun_core::heap::into_raw(HmrSocket::new(...))   // *mut HmrSocket
  → dev.active_websocket_connections.insert(*mut HmrSocket, ())
  → res.upgrade(*mut HmrSocket as user_data, ...)
  
[uws fires callbacks on user_data]
  → on_open(*mut Self, AnyWebSocket)              // unsafe fn
    → reborrow &mut *this; HmrSocket::on_open
  → on_message(*mut Self, AnyWebSocket, msg, op)  // unsafe fn  
    → reborrow &mut *this; HmrSocket::on_message
  → on_close(*mut Self, AnyWebSocket, code, msg)  // unsafe fn
    → STAYS at pointer level; HmrSocket::on_close consumes ownership
    → dev.active_websocket_connections.remove(&s)
    → drop(bun_core::heap::take(s))               // free
```

This mirrors Section F's `ServerWebSocket`/`NodeHTTPResponse` re-entrant FFI pattern exactly. `on_close` is the destroy-self path and correctly stays at the raw-pointer level for its body.

The re-entrant hazard vector identified in Section F (close path may free `self` while a `&mut Self` reborrow is on the stack) does NOT manifest in HmrSocket — `on_close` does not reborrow `&mut *this` before the `bun_core::heap::take(s)` sole-owner consumption.

## Notable patterns

1. **`BackRef<T>` as a "GC-rooted backreference"**: 29 declaration/use sites. `bun_ptr::BackRef<T>` is a non-null pointer with a documented "outlives" contract — used for `HmrSocket.dev: BackRef<DevServer>`, `RouteBundle.cached_response: Option<BackRef<StaticRoute>>`, etc. Replaces Zig's `*Foo` parent-pointer pattern with a typed wrapper. Safe `Deref` only; `unsafe fn` for the `&mut` accessor (as in `HmrSocket::dev<'a>`).
2. **`container_of` / `from_field_ptr!`**: 10 sites. Used to recover `*mut DevServer` from `*mut <field>` (timer, graph, watcher store). The canonical `dev_server::DirectoryWatchStore` implementation also returns a raw pointer and explicitly scopes disjoint-field reborrows. Phase-5 correction: the `&mut DevServer` exception lives in the mounted Phase-A draft module (`directory_watch_store_body`), not in the canonical type; no call sites of the draft type were found. EXP-028 is therefore stale-draft hygiene, not current production UB.
3. **Triple-buffered watcher events with AtomicU8 channel**: `WatcherAtomics` is the most rigorously-documented concurrency type in the section. The DONE/WAITING/INDEX state machine encoded in `AtomicU8` has the canonical `swap` + CAS pair on the JS recycle side. The structural exclusivity ("3 slots, watcher uses ≤2, DevServer uses ≤1") gives a free-slot-always-exists invariant.
4. **`MaybeUninit` intrusive-list nodes**: 25 `assume_init` sites in DevServer.rs `next_bundle.requests` — request payloads stored as `MaybeUninit<DeferredRequestData>` in linked-list nodes, initialized lazily during `defer_request`.
5. **No `unsafe impl Send` / `Sync` except DotenvSingleton**: bake's cross-thread sharing is via `WatcherAtomics` (which is sound by virtue of structural exclusivity, not via a `unsafe impl Sync`). The lone `unsafe impl Sync for DotenvSingleton` is well-justified (single-init, single-reader during CLI init).
6. **No transmute, no set_len, no Pin**: bake is conservative — the only `transmute` mention in the section is a comment in bake_body.rs:285 explaining why a path was *not* taken ("transmute (forbidden per PORTING.md §Forbidden — lifetime extension)").

## Open questions

1. **EXP-028 — stale Phase-A `DirectoryWatchStore::owner` draft** (`DevServer/DirectoryWatchStore.rs:69-81`). The TODO(port) is real in that draft file, but the canonical `dev_server/mod.rs` implementation has already switched to `owner(&mut self) -> *mut DevServer`; no draft-type call sites were found. Keep as hygiene / stale-code cleanup, not a current production finding.
2. **Watcher Box hand-off race on Windows** (`DevServer.rs:1107-1118`). Documented hazard: kernel `ReadDirectoryChangesW` completion vs watcher `running == false` exit check vs `Box<Watcher>` deallocation by watcher thread. Loom + Windows torture test.
3. **uws `websocket.close()` re-entrancy bound** (`DevServer.rs:1083-1099`). Does the synchronous on_close callback dispatched by close() ever transitively close() a sibling socket? Currently mitigated by an up-front Vec snapshot; verify against uws source.
4. **Arena lifetime erasure in Phase B** (`bake_body.rs`, `FrameworkRouter.rs`). Replace `arena_erase` and `'static` lies with a real `'bump` lifetime parameter; the existing patterns are sound but typesystem-unenforced.
5. **`pin_unchecked` audit-JSONL false positive** (S-005476). Phase-0 categorization should re-run with a regex that distinguishes `Pin::new_unchecked` from `NonNull::new_unchecked` / `mem::MaybeUninit::new` to avoid future spurious priors.

---

ported from / cross-ref: Section F (`F_server_jsc_hooks.md`) for the `*mut Self` re-entrant FFI pattern; `UB-TAXONOMY.md` Bucket 17 for async-Drop framing; `phase0_partition.json` Section G for the priors; `.unsafe-audit/unsafe-inventory.jsonl` filtered to `src/runtime/bake/*` for the 295-site prior count.
