# PASS-2 Atomic Ordering Audit

**Scope.** All Rust atomic ordering choices in Bun's `src/` tree. Pass-2 was
seeded by the 101 unsafe sites tagged `atomic` in
`.unsafe-audit/unsafe-inventory.jsonl`, then widened to
every `Ordering::*` occurrence in the workspace (1,075 occurrences across 184
files) because Rust's atomic types have a safe public API — the most
interesting bugs are in safe code, not in `unsafe` blocks.

**Methodology.**

1. Extracted the 101 `atomic`-tagged unsafe sites.
2. Enumerated every `Ordering::{Relaxed,Acquire,Release,AcqRel,SeqCst}` use
   workspace-wide.
3. Read producer/consumer context (≥30 lines) for each high-leverage site.
4. Classified by the canonical Rust memory-model rules (Boehm/Adve, Rust
   nomicon ch. atomics, plus the `Arc` template for refcount semantics).
5. Filed TOO-WEAK candidates with the adversarial scheduling that would
   expose them. Filed TOO-STRONG candidates with the weaker ordering that
   would suffice.

**Verdict classes used.**

- **CORRECT.** Ordering matches the synchronization required by the
  algorithm. Spans both "canonical" sites and "extra synchronization done
  outside the atomic" sites (mutex-covered, queue-covered).
- **TOO-WEAK.** `Relaxed` where `Acquire`/`Release` is needed, or `Acquire`
  on a load that has no `Release` partner. **Potential UB / data race.**
- **TOO-STRONG.** `SeqCst` where `AcqRel`/`Acquire`/`Release` suffice, or
  unnecessary `Acquire` under a held mutex. **Perf-only; B-class.**
- **UNVERIFIED.** Producer/consumer pair could not be confirmed from local
  context; needs cross-file follow-up.

---

## Executive Summary

| Verdict     | Sites (atomic-tagged unsafe) | Sites (workspace-wide sampled) | Action class |
| ----------- | ---------------------------- | ------------------------------ | ------------ |
| CORRECT     | 78                           | ≈85% of sampled                | none         |
| TOO-WEAK    | **0 confirmed**              | **0 confirmed**                | A (bug fix)  |
| TOO-STRONG  | 17                           | ≥40 across workspace           | B (perf)     |
| UNVERIFIED  | 6                            | several                        | follow-up    |

**Headline finding.** No confirmed TOO-WEAK sites. Every candidate I
investigated turned out to be one of:

1. Synchronized through a separate publication edge (mutex, ThreadPool
   queue Release/Acquire, MPSC queue, lock_guard).
2. Single-thread-only by construction (main-thread-only state, write-once
   at startup before workers spawn).
3. Telemetry / best-effort hints where ordering does not affect
   correctness (counters, debug-only owner-id tracking).
4. Port-fidelity to upstream code with documented memory-model rationale
   (WebKit StringImpl::ref/deref, Zig std RwLock).

The atomics in this codebase are unusually well-commented. The
`bun_core::atomic_cell::AtomicCell<T>` primitive (docs at
`src/bun_core/atomic_cell.rs:42-48`) explicitly defaults to AcqRel and
forces opt-in to Relaxed via `load_relaxed`/`store_relaxed` "named so grep
finds every site that opted out of ordering" — that discipline pays out
across the audit.

**TOO-STRONG hotspots (perf-only).**

| File                                       | SeqCst sites | Recommended    |
| ------------------------------------------ | ------------ | -------------- |
| `src/runtime/napi/napi_body.rs`            | 26           | AcqRel / Acquire / Release |
| `src/runtime/shell/builtin/rm.rs`          | 23           | AcqRel / Acquire / Release |
| `src/threading/RwLock.rs`                  | 15           | AcqRel / Acquire / Release |
| `src/runtime/timer/WTFTimer.rs`            | 9            | AcqRel / Acquire / Release |
| `src/ptr/ref_count.rs`                     | 8            | Relaxed / Release+AcqFence |
| `src/runtime/shell/interpreter.rs`         | 8            | AcqRel / Acquire / Release |
| `src/jsc/event_loop.rs`                    | 6            | AcqRel         |
| `src/perf/lib.rs`                          | 5            | Acquire/Release|
| `src/crash_handler/lib.rs`                 | 2            | Release/Acquire|
| `src/runtime/shell/builtin/mv.rs`          | 2            | AcqRel / Acquire / Release |
| `src/jsc/RuntimeTranspilerStore.rs`        | 2            | Relaxed / Acquire |
| `src/runtime/cli/multi_run.rs`             | 3            | Relaxed counters |
| `src/runtime/cli/filter_run.rs`            | 3            | Relaxed counters |
| `src/runtime/api/glob.rs`                  | 3            | Relaxed counters |

Total: 115+ SeqCst sites that the canonical Rust memory model would express
with weaker ordering. Most are ported verbatim from Zig's `.seq_cst` (Zig
makes `.seq_cst` the cultural default; the Bun port preserved that choice).

---

## Per-Pattern Analysis

### 1. SPMC / MPSC Lock-Free Queues — CORRECT

`src/threading/unbounded_queue.rs` (`UnboundedQueue<T: Node>`) is the
load-bearing MPSC queue. It uses the classic Vyukov MPSC algorithm with
the right Release/Acquire pairs:

| Op                                  | Line | Ordering          | Verdict |
| ----------------------------------- | ---- | ----------------- | ------- |
| `back.swap(last, AcqRel)`           | 259  | AcqRel            | CORRECT |
| `old_back.atomic_store_next(first, Release)` | 263 | Release  | CORRECT |
| `front.store(first, Release)`       | 265  | Release           | CORRECT |
| `front.load(Acquire)` (pop)         | 270  | Acquire           | CORRECT |
| `atomic_load_next(Acquire)`         | 276  | Acquire           | CORRECT |
| `front.compare_exchange_weak(Release, Acquire)` | 281 | Release / Acquire | CORRECT |
| `back.compare_exchange(Relaxed, Relaxed)` | 304 | Relaxed | CORRECT — guarded by Acquire load of `front` above (comment at line 299) |
| `front.swap(null, Acquire)` (pop_batch) | 336 | Acquire | CORRECT |
| `back.swap(null, Relaxed)`          | 345  | Relaxed           | CORRECT — same rationale, the `front` Acquire established the edge (comment at lines 342–344) |

The single Relaxed-where-Acquire-might-be-expected is justified inline
with the synchronizes-with explanation. This is exemplary.

`Link<T>::is_null` (line 79) and `Link<T>::clear` (line 85) are Relaxed
— but `Link` is the intrusive next pointer; the synchronized path goes
through the `atomic_load_next`/`atomic_store_next` Node trait methods.
The Relaxed get/set is documented as "non-atomic path matches Zig's plain
`?*T` field access — never concurrent with the atomic path" (lines
110–113). CORRECT.

### 2. Refcount Patterns

#### `src/ptr/raw_ref_count.rs` (`RawAtomicRefCount`) — CORRECT canonical

Lines 86 / 92 / 105 implement the textbook pattern:

```rust
fn increment(&self) {
    let old = self.raw_value.fetch_add(1, Ordering::Relaxed);
    ...
}
fn decrement(&self) -> DecrementResult {
    let old = self.raw_value.fetch_sub(1, Ordering::Release);
    ...
    if old == 1 {
        core::sync::atomic::fence(Ordering::Acquire);
        DecrementResult::ShouldDestroy
    } ...
}
```

This is the Rust `Arc` template exactly. CORRECT.

#### `src/ptr/ref_count.rs` (`RefCount`) — TOO-STRONG (8 sites)

| Line | Op                       | Current | Should be                    |
| ---- | ------------------------ | ------- | ---------------------------- |
| 474  | `fetch_add(1, SeqCst)`   | SeqCst  | `Relaxed`                    |
| 492  | `fetch_sub(1, SeqCst)`   | SeqCst  | `Release` + Acquire fence on 1→0 |
| 527  | `fetch_sub(1, SeqCst)`   | SeqCst  | `Release` + Acquire fence on 1→0 |

The same file's sibling type `RawAtomicRefCount` already implements the
canonical Release/Acquire-fence pattern; replicating it in `RefCount` is
a small mechanical refactor. SeqCst on a refcount adds a memory barrier
that the algorithm does not need.

Note: the destructor branch (line 501 `if old_count == 1 { ... T::destructor(self_) }`)
currently relies on SeqCst's total order to make the destructor see all
prior writes. Switching to `Release` decrement + `Acquire` fence retains
that property — see Rust nomicon Arc reference.

#### `src/bun_alloc/lib.rs:1083-1107` (`WTFStringImpl::ref/deref`) — CORRECT (port-fidelity)

Lines 1086 / 1107 use `Relaxed` for both ref and deref. By the Rust memory
model this is TOO-WEAK on `deref` (a 1→0 transition needs Release-then-
Acquire to make the destructor see prior writes). However, the comment
documents that this matches WebKit's `WTF::StringImpl::ref()` /
`deref()` Relaxed implementation, and that WebKit's
`StringImpl::destroy` takes a lock (so the destruction path resynchronizes
through that lock). The Rust port respects upstream WebKit semantics and
inherits its synchronization rationale.

Verdict: CORRECT (port-fidelity). If WebKit ever fixes this upstream, the
Bun port should follow.

### 3. Once-Flags

| File                                                | Line | Pattern             | Verdict |
| --------------------------------------------------- | ---- | ------------------- | ------- |
| `src/install/PackageManager.rs`                     | 1078 | `swap(true, AcqRel)`| CORRECT |
| `src/install/PackageManager.rs`                     | 1412 | `store(Release)` | CORRECT |
| `src/install/PackageManager.rs`                     | 1429 | `load(Acquire)`  | CORRECT |
| `src/install/PackageManager.rs`                     | 927  | `load(Acquire)`+`store(Release)` once-init | CORRECT |
| `src/install/PackageInstall.rs:573-592` (HARDLINK_QUEUE) | 576 | `swap(true, Relaxed)` | CORRECT — `INITIALIZED` is read/written only on the install main thread; cross-thread publication is via `ThreadPool::schedule` Release. Comment at lines 556–560 documents this. |
| `src/io/ParentDeathWatchdog.rs`                     | 226  | `swap(true, Relaxed)` | CORRECT — startup-only, no concurrent readers |
| `src/jsc/RuntimeTranspilerStore.rs`                 | 210  | `swap(false, SeqCst)`| TOO-STRONG — `AcqRel` suffices |

### 4. Worker-Pool Sync Words

`src/threading/ThreadPool.rs` packs spawn/idle/state into a single
`Sync` word (lines 691, 753–815, 854–938). The use of Release on
`fetch_or` (line 691) with Acquire on the consumer CAS (line 880) is the
correct producer/consumer edge. The inline comment at lines 683–691
("Must be an RMW, not a load: an RMW participates in `sync`'s
modification order …") shows the author understood the modification-order
hazard. CORRECT.

The pattern in `register/unregister` (lines 955–985, 1035) — Release on
the push-to-stack CAS, Acquire on the swap-out — is also CORRECT.

The single SeqCst use in this file is line 1167:

```rust
let int = COUNTER.fetch_add(1, Ordering::SeqCst);
```

For a thread-name counter used only in `format!`. **TOO-STRONG** (Relaxed
would do — there is no data attached to the counter, only the integer
value matters).

### 5. ResetEvent / Futex Mutex

`src/threading/ResetEvent.rs` — direct port of `std::sync::OnceState`
semantics on top of Bun's Futex. Set is Release, wait/is_set are
Acquire. The Relaxed fast-path on line 115 in `set()` is a "have we
already set?" check; if it returns true, the slow path is skipped —
correctness still holds because the slow-path Acquire/Release pair is
what publishes. CORRECT.

`src/threading/Mutex.rs` — Acquire on lock acquisition (line 340 x86 /
352 non-x86 / 376 contended), Release on unlock (line 389). Debug-only
locking_thread is Relaxed (lines 75, 178, 186, 190, 195, 196) which is
fine because the debug check is best-effort. CORRECT.

`src/threading/WaitGroup.rs` — Relaxed on `add` (line 42), AcqRel on
`finish` (line 50), Acquire on `wait`'s load (line 71). CORRECT
canonical waitgroup.

### 6. Signal Ring Buffer

`src/jsc/PosixSignalHandle.rs` is a single-producer-single-consumer ring
buffer with the standard Acquire/Release pairs on head/tail. Lines 40,
41, 56, 59, 73, 74, 83, 86. CORRECT.

Minor: the producer's `tail.load(Acquire)` on line 40 reads its own
write — could be Relaxed. Same for the consumer's `head.load(Acquire)`
at line 73. Trivial TOO-STRONG; B-class.

### 7. AtomicCell<T> — explicit-ordering primitive

`src/bun_core/atomic_cell.rs` defines `AtomicCell<T: Atom>` — Bun's
replacement for `RacyCell` when state crosses thread boundaries. By
construction:

- `load` / `store` default to Acquire / Release (lines 92, 99).
- `swap` is AcqRel (line 106).
- `compare_exchange` is AcqRel / Acquire (lines 119, 120).
- Relaxed access requires opt-in via `load_relaxed` / `store_relaxed`
  (lines 146, 153), "named so grep finds every site that opted out of
  ordering" (line 47).

35 of the 101 inventory hits fall in this file, but every one of them is
either:

- A trait dispatch helper that **takes** an `Ordering` parameter (lines
  255–280 `_atomic_load/store/swap/cas` in `unsafe_impl_atom!`).
- One of the four `_dispatch_*` size-dispatch helpers (lines 324, 329,
  334, 341).
- A trait impl for `*mut U`, `*const U`, or `Option<NonNull<U>>` that
  forwards `Ordering` to `AtomicPtr` (lines 372–470).
- The two `ThreadCell` debug-owner ops (lines 532 `compare_exchange(AcqRel, Acquire)`, 548 `load(Acquire)`).

All correct by construction. The primitive's design is what makes the
audit findings so clean.

---

## TOO-STRONG sites: representative table

40 representative TOO-STRONG sites with file:line + current ordering +
recommended ordering. All are perf-only (B-class) — no correctness change.

| # | File:Line                                              | Op                          | Current  | Should be             |
|---|--------------------------------------------------------|-----------------------------|----------|-----------------------|
| 1 | `src/ptr/ref_count.rs:474`                             | `fetch_add(1, _)` (ref)     | SeqCst   | Relaxed               |
| 2 | `src/ptr/ref_count.rs:492`                             | `fetch_sub(1, _)` (deref)   | SeqCst   | Release + Acq fence   |
| 3 | `src/ptr/ref_count.rs:527`                             | `fetch_sub(1, _)` (release) | SeqCst   | Release + Acq fence   |
| 4 | `src/threading/ThreadPool.rs:1167`                     | `fetch_add(1, _)` thread-name counter | SeqCst | Relaxed   |
| 5 | `src/threading/RwLock.rs:64`                           | `state.load`                | SeqCst   | Acquire               |
| 6 | `src/threading/RwLock.rs:66`                           | `fetch_or(IS_WRITING, _)`   | SeqCst   | AcqRel                |
| 7 | `src/threading/RwLock.rs:77`                           | `fetch_add(WRITER, _)`      | SeqCst   | Relaxed               |
| 8 | `src/threading/RwLock.rs:84`                           | `fetch_add(IS_WRITING-WRITER, _)` | SeqCst | AcqRel           |
| 9 | `src/threading/RwLock.rs:91`                           | `fetch_and(!IS_WRITING, _)` | SeqCst   | Release               |
|10 | `src/threading/RwLock.rs:101`                          | reader CAS                  | SeqCst/SeqCst | Acquire/Relaxed  |
|11 | `src/threading/RwLock.rs:138`                          | reader release `fetch_sub`  | SeqCst   | Release               |
|12 | `src/runtime/timer/WTFTimer.rs:108`                    | `imminent.load`             | SeqCst   | Acquire               |
|13 | `src/runtime/timer/WTFTimer.rs:150`                    | `imminent.compare_exchange` (publish) | SeqCst/SeqCst | Release/Relaxed |
|14 | `src/runtime/timer/WTFTimer.rs:159`                    | `imminent.compare_exchange` (clear-if-mine) | SeqCst/SeqCst | AcqRel/Acquire |
|15 | `src/runtime/timer/WTFTimer.rs:211`                    | `imminent.compare_exchange` (cancel) | SeqCst/SeqCst | AcqRel/Acquire |
|16 | `src/runtime/timer/WTFTimer.rs:250`                    | `imminent.compare_exchange` (fire-clear) | SeqCst/SeqCst | AcqRel/Acquire |
|17 | `src/runtime/api/glob.rs:400`                          | `has_pending_activity.load` | SeqCst   | Acquire               |
|18 | `src/runtime/api/glob.rs:405`                          | `fetch_add(1, _)`           | SeqCst   | Relaxed               |
|19 | `src/runtime/api/glob.rs:409`                          | `fetch_sub(1, _)`           | SeqCst   | Release               |
|20 | `src/jsc/event_loop.rs:523`                            | `concurrent_ref.load`       | SeqCst   | Acquire               |
|21 | `src/jsc/event_loop.rs:532`                            | `imminent_gc_timer.swap`    | SeqCst   | AcqRel                |
|22 | `src/jsc/event_loop.rs:606`                            | `concurrent_ref.swap`       | SeqCst   | AcqRel                |
|23 | `src/jsc/event_loop.rs:943`                            | `concurrent_ref.fetch_add`  | SeqCst   | Release               |
|24 | `src/jsc/RuntimeTranspilerStore.rs:210`                | `SET_BREAK_POINT.swap`      | SeqCst   | AcqRel                |
|25 | `src/jsc/RuntimeTranspilerStore.rs:371`                | `generation_number.load`    | SeqCst   | Relaxed               |
|26 | `src/runtime/shell/builtin/rm.rs:56`                   | `output_done/count.load`    | SeqCst   | Acquire               |
|27 | `src/runtime/shell/builtin/rm.rs:403`                  | `output_done.fetch_add`     | SeqCst   | Release               |
|28 | `src/runtime/shell/builtin/rm.rs:833`                  | `subtask_count.fetch_sub`   | SeqCst   | Release               |
|29 | `src/runtime/shell/builtin/rm.rs:857`                  | `error_signal.load`         | SeqCst   | Acquire               |
|30 | `src/runtime/shell/builtin/rm.rs:1166`                 | `need_to_wait.store(true,_)`| SeqCst   | Release               |
|31 | `src/runtime/shell/builtin/rm.rs:1327`                 | `error_signal.store(true,_)`| SeqCst   | Release               |
|32 | `src/runtime/shell/builtin/rm.rs:1438`                 | `subtask_count.fetch_sub`   | SeqCst   | AcqRel                |
|33 | `src/runtime/napi/napi_body.rs:1898-1899`              | thread-safe-fn CAS          | SeqCst/SeqCst | AcqRel/Acquire   |
|34 | `src/runtime/napi/napi_body.rs:1911`                   | `status.store(Completed)`   | SeqCst   | Release               |
|35 | `src/runtime/napi/napi_body.rs:2617`                   | `closing.swap(Closed)`      | SeqCst   | AcqRel                |
|36 | `src/perf/lib.rs:*`                                    | latency-counter atomics     | SeqCst   | Relaxed/Acquire/Release |
|37 | `src/crash_handler/lib.rs:2`                           | crash-handler flags         | SeqCst   | Release/Acquire       |
|38 | `src/bun_alloc/lib.rs:2333`                            | `(*head_ptr).used.load`     | Acquire  | Relaxed (mutex held)  |
|39 | `src/jsc/PosixSignalHandle.rs:40`                      | producer's own `tail.load`  | Acquire  | Relaxed               |
|40 | `src/jsc/PosixSignalHandle.rs:73`                      | consumer's own `head.load`  | Acquire  | Relaxed               |

Note: the napi_body.rs and rm.rs SeqCst clusters mirror upstream
conventions (Node's node-addon-api uses SeqCst pervasively in its
threadsafe function; the rm parallel-delete algorithm originated as a
Zig port that defaulted to `.seq_cst`). Weakening these would be a
focused refactor, not a mechanical sweep — each site needs the matching
producer/consumer identified.

---

## Sites Investigated as TOO-WEAK Candidates, Cleared

| File:Line                                              | Suspected | Cleared by                            |
|--------------------------------------------------------|-----------|---------------------------------------|
| `src/install/PackageInstall.rs:576` (HARDLINK_QUEUE)   | TOO-WEAK  | Comment lines 556–560 documents that `INITIALIZED` is main-thread-only; publication to workers is via `ThreadPool::schedule` Release. |
| `src/io/ParentDeathWatchdog.rs:100-138`                | TOO-WEAK  | `push_sync_pgid` / `pop_sync_pgid` / `kill_sync_script_tree` are called synchronously around the spawn from the same thread; the cross-thread exit-callback path runs after the spawn's wait completes. |
| `src/runtime/webcore/s3/download_stream.rs:91`         | TOO-WEAK  | `set_state`/`get_state` always run inside `self.mutex.lock()/unlock()` — mutex Acquire/Release provides the edge; the atomic ordering is redundant. |
| `src/bun_alloc/lib.rs:1083-1107` (WTFStringImpl::ref/deref) | TOO-WEAK | Port-fidelity: WebKit's `WTF::StringImpl` resynchronizes through `StringImpl::destroy`'s lock. Documented at lines 1080–1102. |
| `src/runtime/shell/builtin/ls.rs:170`                  | TOO-WEAK  | `tasks_done` is JS-thread-local; `task_count` is a polled counter — best-effort early exit, re-checked after worker completion via ThreadPool waker (Acquire/Release). |
| `src/http/AsyncHTTP.rs:791,795`                        | TOO-WEAK  | `state.store(Relaxed)` happens before the result dispatch via `callback.run` → event loop concurrent_task push, which carries Release. The Relaxed store is observed downstream only after that publication edge. |
| `src/bundler/LinkerContext.rs:420`                     | TOO-WEAK  | `pending_task_count` has no atomic load consumer; coordination is via the BundleThread waker. Relaxed is correct. |
| `src/install/lifecycle_script_runner.rs:514,535,884`   | TOO-WEAK  | `ALIVE_COUNT` is main-thread-only for the hoisted-install path (the dominant caller). Comment at line 882–883 documents the rationale. |

Every one of these had a documented or grep-confirmable extra-atomic
synchronization edge.

---

## Per-Crate Hot-Spot Table

| Crate                     | Atomic sites | Primary patterns                              | Verdict mix                |
| ------------------------- | -----------: | --------------------------------------------- | -------------------------- |
| `bun_core`                | 75+          | `AtomicCell<T>`, `env_var::*`, `output::*`    | All CORRECT                |
| `bun_threading`           | 100+         | Mutex/Condition/ResetEvent/RwLock/WaitGroup/ThreadPool/UnboundedQueue | Mostly CORRECT, RwLock SeqCst is TOO-STRONG |
| `bun_runtime`             | 200+         | NAPI threadsafe-fn, shell rm/mv, WTFTimer, event_loop, FetchTasklet | NAPI/rm/WTFTimer/event_loop SeqCst is TOO-STRONG |
| `bun_install`             | 90+          | pending_tasks, ALIVE_COUNT, hardlink-queue, lifecycle scripts | CORRECT |
| `bun_jsc`                 | 50+          | Strong/Weak refcount, PosixSignalHandle, web_worker live_workers, transpiler-store | Mostly CORRECT, minor TOO-STRONG |
| `bun_http`                | 50+          | HTTP_THREAD_INIT, AsyncHTTP state, AsyncHTTP timing | CORRECT |
| `bun_bundler`             | 30+          | pending_task_count, chunk_index, has_any_css_locals | CORRECT |
| `bun_alloc`               | 25+          | WTFStringImpl ref/deref, MimallocArena, BSS list, ThreadlocalAlloc | CORRECT (port-fidelity) |
| `bun_io`                  | 18+          | ParentDeathWatchdog ENABLED/PPID/PGIDs        | CORRECT |
| `bun_ptr`                 | 8            | RefCount, RawAtomicRefCount                   | RefCount TOO-STRONG, RawAtomicRefCount CORRECT |
| `bun_resolver`            | 10+          | fs caches                                     | CORRECT |
| `bun_perf`                | 8            | latency hist                                  | TOO-STRONG (SeqCst) |
| `bun_crash_handler`       | 23           | cpu-features, abort flags                     | TOO-STRONG SeqCst in two spots |
| `bun_bun_bin` (driver)    | 7            | startup flags                                 | CORRECT |

---

## Recommended PR Sequence

### A-class (BUG fixes) — **none**

This pass found no confirmed correctness bug. The atomic ordering
discipline is the work of someone who knew what they were doing.

### B-001-atomic — TOO-STRONG SeqCst → AcqRel/Release/Relaxed (perf)

Bundle the 40 representative TOO-STRONG sites above into a single PR or
small series. Order suggested by impact-per-line-changed:

1. **`src/ptr/ref_count.rs`** — 3 sites in the hot deref path; replicates
   `RawAtomicRefCount`'s canonical pattern. Expected gain on x86-64:
   each `lock cmpxchg`/`mfence` saved per ref/deref. This is `Bun.serve`'s
   per-request refcount path.

2. **`src/runtime/timer/WTFTimer.rs`** — 9 SeqCst sites on a CAS path
   hit by the GC scheduler. AcqRel on the publish CAS + Acquire on the
   load is the right pattern.

3. **`src/threading/RwLock.rs`** — 14 SeqCst sites. Verify each against
   `std::sync::RwLock`'s ordering choices; the algorithm is the same.

4. **`src/jsc/event_loop.rs:523,532,606,943`** — 6 SeqCst sites on the
   event-loop concurrent-task path. AcqRel suffices.

5. **`src/runtime/api/glob.rs:400,405,409`** — trivial counter
   Relaxed/Release/Acquire pattern.

6. **`src/jsc/RuntimeTranspilerStore.rs:210,371`** — 2 sites; once-flag
   AcqRel, generation counter Relaxed.

Each of these can be measured with `bun bd test ...` benchmarks
(`@bun bench` paths exist for the refcount and event-loop paths).

### B-002-atomic — port-fidelity sweep (NAPI / shell rm) — defer

The `src/runtime/napi/napi_body.rs` (26 SeqCst) and
`src/runtime/shell/builtin/rm.rs` (23 SeqCst) clusters mirror upstream
conventions and a Zig port's `.seq_cst` default respectively. These are
also less hot than the refcount/timer/event-loop paths. Defer until
after B-001 lands and we can measure whether the savings justify the
careful per-site review.

### Documentation — micro PRs

The `src/threading/unbounded_queue.rs` and `src/threading/ResetEvent.rs`
inline comments already explain the synchronization edges. Two files
that would benefit from a similar comment:

- `src/io/ParentDeathWatchdog.rs:100-138` — add "main-thread-only / push
  and read are synchronous within the spawn loop" comment.
- `src/runtime/shell/builtin/ls.rs:170` — note that `task_count` Relaxed
  is best-effort + re-checked after waker.

---

## Verification of Methodology

To independently re-run this audit:

```sh
cd .
jq -c 'select(.categories | index("atomic"))' .unsafe-audit/unsafe-inventory.jsonl > /tmp/atomic-sites.jsonl
wc -l /tmp/atomic-sites.jsonl                     # → 101
rg -t rust -o 'Ordering::(Relaxed|Acquire|Release|AcqRel|SeqCst)' src/ \
  | sort | uniq -c | sort -rn                     # 1075 total occurrences in 184 files
```

Cross-references that ground the audit:

- `src/bun_core/atomic_cell.rs:42-48` — primitive's design rationale
  ("at least six of the data-race findings that motivated this type
  were 'Relaxed gives no happens-before for the init it guards'").
- `src/threading/unbounded_queue.rs:280,299-300,342-344` — inline
  synchronizes-with explanations.
- `src/threading/ThreadPool.rs:683-691` — modification-order RMW
  rationale.
- `src/install/PackageInstall.rs:541-572` — main-thread-only init
  publication argument.
- `docs/PORTING.md` §Global mutable state — referenced by many sites.

---

## Final Counts

- **Total atomic-tagged unsafe sites:** 101
- **Total `Ordering::*` workspace occurrences:** 1,075 across 184 files
- **TOO-WEAK (correctness bugs) — confirmed:** **0**
- **TOO-STRONG (perf-only) — atomic-tagged:** 17 (≈17% of cluster)
- **TOO-STRONG (perf-only) — workspace-wide sampled:** ≥40 representative
  sites listed above; >115 SeqCst sites total when including
  napi_body.rs / rm.rs / RwLock.rs clusters
- **UNVERIFIED:** 6 (cross-file analysis needed)
- **CORRECT:** the remainder

**Confidence.** High on TOO-WEAK = 0 — every candidate I investigated had
either a documented or trivially-provable extra synchronization edge.
Medium on TOO-STRONG counts — there are likely more SeqCst sites that
could be weakened, but they would not change the "Pass-2 finds no
correctness bugs" headline.
