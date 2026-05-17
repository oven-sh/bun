# Phase 2 Findings — Bucket 17: Async Drop Hazards

Run: `2026-05-15-exhaustive` · Sub-agent: static-bucket-sweeper-17-async-drop ·
Source revision: audited base `origin/main@4d443e5402`. This file originally
inherited the prior unsafe-audit branch label; Codex corrected the label on
2026-05-16. Latest-main drift after `4d443e5402` is handled separately in
`CODEX_MAIN_DRIFT_NOTE_2026-05-16.md` / `CODEX_W4_REFRESH_TRIAGE_2026-05-16.md`.

## Verdict: **N/A in the canonical sense — Bun does not use `async fn` / tokio / `block_on`**

Bucket 17 (`UB-TAXONOMY.md §17`) targets the well-known "`tokio::block_on`
inside `Drop` deadlocks the runtime" hazard and the
"`JoinHandle` dropped without `.await`" detach silently" hazard. The first
shape **cannot exist in Bun**, and the second has been deliberately, uniformly
encoded as the intentional detach idiom.

### Project-specific rationale (from CLAUDE.md, Phase-1 G, and direct grep)

| signal | result | command |
|---|---|---|
| `async fn` declarations in `src/` | **0** | `rg 'async fn' --type rust src/` |
| `impl Future for …` / `impl core::future::Future` | **0** | `rg 'impl Future for\|impl (core\|std)::future::Future'` |
| `tokio`/`async_std`/`smol` imports | **0** | `rg 'use tokio\|use async_std\|use smol' --type rust src/` (only hit: `smol_str::SmolStr` — a string lib, unrelated) |
| `block_on` / `spawn_blocking` / `Handle::current` | **0** | `rg 'block_on\|spawn_blocking\|enter\(\)' --type rust src/` |
| `.await` callsites | **0** in compiled Rust | grep hits are `await_keyword_loc`/`await_target` inside the **JS parser** (i.e. Bun's parser recognises JS `await`, not Rust's) |
| `JoinHandle` references | **9** (all detached, see §JoinHandle below) | `rg 'JoinHandle' --type rust src/` |

CLAUDE.md `src/CLAUDE.md` is explicit: the runtime is built as
`libbun_rust.a` linked against the C++ JavaScriptCore + libuv +
uWebSockets / uSockets. Concurrency primitives are OS threads
(`std::thread`), atomics, futexes (`bun_threading`), and the libuv / uWS
event loops, **not Rust `Future`s**. Phase-1 G already documented this for
the `runtime/bake/` subtree ("Bake has zero async-runtime/`block_on`
paths"); the same is true workspace-wide.

The canonical Bucket 17 shape therefore maps to **the synchronous analogue**:
`Drop` impls that

1. block on an OS thread `.join()`,
2. dispatch synchronously into FFI that may re-enter the same allocation, or
3. transfer ownership of a heap allocation to a still-running worker thread.

These are the three categories I enumerated below.

---

## Drop-body audit summary

`rg 'impl Drop for' --type rust src/ | wc -l` → **277 `Drop` impls** in
`src/`. After per-file inspection focused on Drop bodies that touch
threads, the event loop, FFI close cascades, or refcount handoff, only the
sites below carry non-trivial completion / re-entrancy hazards. The
remaining ~270 are straightforward field cleanups (Vec / Box / Cell
release, FFI handle close, refcount decrement) with no blocking-wait
shape.

### Category A: `Drop` blocks on `JoinHandle::join()` — 1 site

| site | shape | hazard class | mitigation |
|---|---|---|---|
| `src/runtime/node/fs_events.rs:858-887` `Drop for FSEventsLoop` | enqueues a `_stop` task onto the CFRunLoop, then `self.thread.take().unwrap().join()` (line 865), then releases the CF signal source and nulls the per-watcher `loop_` field | blocks the dropping thread until the CFRunLoop has actually stopped; if `enqueue_task_concurrent` ever drops a signal or the CFRunLoop is wedged the dropper hangs forever | the `_stop` task is enqueued *before* the join, and FSEventsLoop is documented as a **process-global default-init loop** (`fsevents::FSEventsLoop` is constructed via `heap::alloc` and held in a `OnceLock`-style slot — the Drop body therefore only runs during process shutdown / on test-harness teardown, never from the JS thread). **No `async-runtime` involvement; no `Future` to deadlock on.** |

This is the one truly synchronous "block-on-completion" Drop in the runtime.
It is sound on the documented contract (CFRunLoop is single-threaded and
will pick up the stop task), but the failure mode if the contract breaks is
**a hang at exit**, not memory unsafety.

### Category B: `Drop` blocks on `ThreadPool::join()` — bundler-only

| site | shape | hazard class |
|---|---|---|
| `src/threading/ThreadPool.rs:315-321` `Drop for ThreadPool` | `self.shutdown(); self.join();` where `join()` (line 1019) calls `self.join_event.wait()` (a futex/condvar `wait`) | blocks until every worker thread has exited |

`ThreadPool` is **bundler-only** (`src/bundler/ThreadPool.rs` wraps it for
`bun build`). It is never instantiated inside a JS request, never inside
`Bun.serve`'s event loop, never on the JS thread for the lifetime of a
running server. It's a CLI-process-scoped resource. The Drop is invoked at
`bun build` completion, which is the correct time to block. **Not a
Bucket-17 hazard** in the async-context sense; it is just a synchronous
shutdown barrier.

### Category C: `Drop` transfers ownership of a heap allocation to a still-running thread — 2 sites

| site | shape | what could go wrong |
|---|---|---|
| `src/runtime/bake/DevServer.rs:1072-1118` `Drop for DevServer` | `ManuallyDrop::take(&mut self.bun_watcher)` + `Watcher::shutdown(Box::into_raw(watcher), true)` — hands ownership of the `Box<Watcher>` to the watcher thread, which frees the allocation in `thread_main` once `running` flips false | on Windows the kernel retains a pending `ReadDirectoryChangesW` against the inline 64 KiB `DirWatcher.buf` + `overlapped`; if the watcher thread's `running == false` check sees the flag before the kernel completion has drained, the freed block being recycled by mimalloc for a later allocation is a kernel write into live unrelated heap data |
| `src/watcher/Watcher.rs:247-266` `Watcher::shutdown` (not a `Drop`, called by the above) | same Box hand-off mechanism, but flips `close_descriptors` / `running` under `self.mutex` before signalling | the receiving thread `Drop`s the Box inside `thread_main` once it exits its inner loop |

Phase-1 G already flagged this as the most fragile DevServer Drop site (see
`phase1_inventory_G.md:84`: *"the watcher-thread-frees-the-Box pattern is
documented but unproven against a concurrent kernel
`ReadDirectoryChangesW` completion racing with Watcher's `running == false`
check"*). It is **not** the canonical async-Drop hazard (no async runtime
involved); it is a hand-rolled cross-thread ownership-transfer race that
should be closed with a per-platform integration test (Windows watcher
torture) or a `loom` model.

### Category D: `Drop` dispatches synchronous FFI that may re-enter — N sites, all bounded

The dominant `Drop`-with-side-effect shape in Bun is

```rust
impl Drop for X {
    fn drop(&mut self) {
        // close native handle / unlink from event loop / force-close sockets
        self.close_*();
        // refcount decrement on parent
        unsafe { Parent::deref(self.parent) };
    }
}
```

Representative examples I read in full:

- `Drop for DevServer` (above) snapshots WS-connection keys before closing
  to avoid iterator-invalidation during the synchronous `HmrSocket::on_close`
  callback.
- `Drop for HTTPContext<SSL>` (`src/http/HTTPContext.rs:1054-1106`) iterates
  pooled keepalive sockets and force-closes them via `pooled.http_socket.close(uws::CloseKind::Failure)` to avoid a clean-shutdown handshake that would never complete during eviction. Explicitly tolerates a half-initialised `group` (skips group teardown when `loop_` is null).
- `Drop for ShellSubprocess` (`src/runtime/shell/subproc.rs:300`) calls
  `finalize_sync()` which closes the process + all three stdio pipes.
  No thread join.
- `Drop for SpawnSyncEventLoop` (`src/event_loop/SpawnSyncEventLoop.rs:279`)
  calls `__bun_spawn_sync_destroy_event_loop(self.event_loop);
  uws::Loop::destroy(self.uws_loop.as_ptr())` — straight FFI, no waits.
- `Drop for PendingConnect` (`src/http/h3_client/PendingConnect.rs:31`)
  decrements one ref on the session. Sound.
- `Drop for ClientSession` (`src/http/h3_client/ClientSession.rs:471`) just
  `debug_assert!(self.pending.is_empty())`. Sound.

None of these block; all run synchronously to completion.

---

## JoinHandle audit — 9 references, all intentionally detached

| site | mechanism | doc |
|---|---|---|
| `src/bundler/BundleThread.rs:406` | `drop(os_thread)` immediately after spawn | comment cites `std.Thread.detach()` |
| `src/http/HTTPThread.rs:1072-1098` | parked in `static HTTP_THREAD_HANDLE: OnceLock<JoinHandle>` to satisfy LSAN reachability (an Arc inside `JoinHandle::Inner` was being reported as a direct leak when the original Zig `.detach()` semantics were used with `drop(JoinHandle)`) | multi-paragraph PORT NOTE explains the LSAN false-positive workaround |
| `src/io/lib.rs:769-773` | implicit `JoinHandle` drop (return value of `Builder::spawn` is `unwrap_or_else`-panicked) | "Zig: `thread.detach()` — Rust JoinHandle detaches on drop" |
| `src/jsc/Debugger.rs:598-606` | implicit drop of `Builder::spawn` return | "Spec: `thread.detach()` — Rust JoinHandle detaches on drop" |
| `src/runtime/api/bun/Terminal.rs:720-721` | `Ok(_t) => { /* detached */ }` | "JoinHandle dropped without join → thread runs to completion" |
| `src/runtime/cli/create_command.rs:2855-2901` | stored in `static THREAD: RacyCell<Option<JoinHandle>>` for the `git` CLI, **joined** in `wait()` (line 2901) | not detached — the only joining JoinHandle in J |
| `src/runtime/cli/open.rs:373-378` | implicit drop after `Builder::spawn` | "detaching the thread" |
| `src/runtime/cli/publish_command.rs:1273-1274` | `Ok(_t) => { /* JoinHandle dropped → detached */ }` | inline comment |
| `src/runtime/node/fs_events.rs:351` | stored in `FSEventsLoop.thread: Option<JoinHandle>`, **joined** in `Drop for FSEventsLoop` (the Category A site above) | not detached |
| `src/runtime/node/path_watcher.rs:691` | `Ok(handle) => drop(handle), // detach` | inline comment |
| `src/runtime/node/path_watcher.rs:1230` | implicit drop | (kqueue thread path) |
| `src/watcher/Watcher.rs:233` | stored in `Watcher.thread: Option<JoinHandle>`; teardown via the Category C hand-off (NOT via `.join()`) | comment explains the cross-thread Box hand-off contract |

**Verdict:** zero `JoinHandle` is silently leaked. Every site is either
parked in a `'static` slot, joined deterministically by an explicit `wait()`
/ `Drop`, or carries a per-site comment that documents the intentional
detach (matching the original Zig `std.Thread.detach()` semantics). The
JoinHandle-drop-without-await UB shape from §17 **does not apply**: there
is no `Future` whose cancellation point is being skipped — these are bare
OS threads that have already accepted a "run to completion" contract.

---

## Cross-bucket pointers

- **Bucket 7 (Data races)**: the Category C "watcher thread frees the Box"
  race is in scope for Phase-3 `loom` / TSan modelling. Tracked separately
  in Section G's open question #2 and in the `DEVELOPMENT_NOTES.md` Phase-1
  bake entry.
- **Bucket 21 (FFI callback aliasing)**: `Drop for DevServer`'s synchronous
  WS-close cascade is covered there.
- **Bucket 11 (Panic safety)**: panic-in-Drop is a separate hazard from
  async-Drop and is handled by `HiveSlot` panic-safe pooling
  (`src/runtime/server/server_body.rs:3140-3170`, see Phase-1 F).

---

## Top-3 concerning patterns (mapped to the Bucket-17 analogue)

1. **`Drop for FSEventsLoop` blocks on `thread.join()` after enqueueing a
   `_stop` task** (`src/runtime/node/fs_events.rs:858-887`). Bun's only
   true "Drop blocks on a thread" site. Safe under the documented
   process-shutdown-only contract; failure mode is a hang, not UB.

2. **`Drop for DevServer` hands `Box<Watcher>` to a still-running thread**
   (`src/runtime/bake/DevServer.rs:1072-1118` → `Watcher::shutdown`). Open
   question for Phase 3: prove the Windows `ReadDirectoryChangesW`
   completion drains before the watcher's `running == false` exit check.
   Section G already flagged this; tracking remains there.

3. **`Drop for ThreadPool` blocks on `join_event.wait()`**
   (`src/threading/ThreadPool.rs:315-321`). Bundler-only; sound at the use
   site (`bun build` completion). Listed for completeness — the shape is
   "Drop blocks the dropping thread on a futex" which is the Bucket-17
   analogue, but the JS event loop is never the dropping thread.

---

## Final classification

- **CONFIRMED-UB**: none.
- **LIKELY-UB**: none.
- **SUSPICIOUS**: `Drop for DevServer` Windows watcher Box hand-off
  (already tracked in Section G as a Phase-3 loom/TSan candidate; this
  bucket only re-states it from the async-Drop angle).
- **CONTRACTUAL-BUT-DEFENSIBLE**: `Drop for FSEventsLoop` (`thread.join`
  on contract-documented process-shutdown-only path),
  `Drop for ThreadPool` (bundler-only).

**No new findings unique to Bucket 17.** The bucket's defining hazards
(`tokio::block_on` deadlock, `JoinHandle` drop without `.await`) do not
exist in Bun. The synchronous analogue is already covered by Buckets
1/4/7/21 audits and the existing Phase-1 G open questions.
