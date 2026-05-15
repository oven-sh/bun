# A-002 — Heap Round-Trip & Raw Pointer Lifecycle Deep Audit

Pass-2 deep-dive of the `raw_ptr_lifecycle` / `bun_heap_lifecycle` / `smart_ptr_raw`
cluster of unsafe sites in the Bun runtime. Targets `Box::from_raw` /
`Box::into_raw` / `Arc::from_raw` / `Arc::into_raw` / `Rc::*_raw` /
`bun_core::heap::{alloc, alloc_nn, into_raw, into_raw_nn, release, take,
destroy, leak}` and their FFI hand-off / refcount-finalizer pairings.

Scope counts (from `.unsafe-audit/unsafe-inventory.jsonl`,
filtered by category tags):

| Category            | Sites |
| ------------------- | ----- |
| `raw_ptr_lifecycle` |   537 |
| `bun_heap_lifecycle`|   204 |
| `smart_ptr_raw`     |    55 |

Total unique sites in the union: **741** (raw_ptr_lifecycle is the union — it
fires on every `from_raw_parts` slice ctor as well; `bun_heap_lifecycle` ∪
`smart_ptr_raw` = **259** more-focused sites that match the prompt's intent).

Higher-tier counts from a direct `rg`:

| Spelling                                           | Sites |
| -------------------------------------------------- | ----- |
| `heap::{into_raw,alloc,alloc_nn,into_raw_nn,release,leak}` | 982 |
| `heap::{take,destroy}`                             | 538   |
| `Box::into_raw` (direct, non-`heap::` wrappers)    |  62   |
| `Box::from_raw` (direct, non-`heap::` wrappers)    |  51   |
| `Arc::{into_raw,from_raw,increment_strong_count,decrement_strong_count}` | 23 |
| `Rc::{into_raw,from_raw,increment_strong_count,decrement_strong_count}`  |  7 (incl. doc comments) |
| `Box::leak` (direct)                               | ~80 (most are documented hand-offs) |

`heap::into_raw`/`alloc`/`leak`/`release` outnumber `heap::take`/`destroy`
nearly 2:1, which is expected — most JS-class payloads are produced exactly
once and reclaimed by the GC finalizer (which dispatches to a centralized
`heap::take`-equivalent in the codegen).

Crate distribution of the focused `bun_heap_lifecycle ∪ smart_ptr_raw` slice:

```text
133  bun_runtime          22  bun_jsc            13  bun_install
  8  bun_bundler           7  bun_io              7  bun_spawn
  6  bun_libuv_sys         6  bun_ptr             4  bun_collections
  4  bun_event_loop        4  bun_http            4  bun_threading
  …  (singletons / pairs in bun_alloc, bun_core, bun_http_jsc,
       bun_sourcemap, bun_sql_jsc, bun_watcher, bun_ast, bun_resolver)
```

---

## Executive summary

The Bun runtime's heap-round-trip surface is **substantially better than the
average Rust-port codebase of equivalent size**. Three structural reasons:

1. **A centralized `bun_core::heap` helper module** (108 LOC at
   `src/bun_core/heap.rs`) encodes the vocabulary (`alloc`/`into_raw`/
   `release`/`take`/`destroy`/`alloc_nn`/`into_raw_nn`), each spelled to read
   correctly at the call site ("release = hand-off, not leak"; "take =
   reclaim a Box"; "destroy = reclaim + drop in one step"). Most call sites
   use the named helper rather than open-coded `Box::into_raw` / `from_raw`.
2. **A typed-helper layer above that** owns BOTH halves of common
   round-trips so call sites never spell either:
   - `bun_threading::WorkPool::schedule_owned` / `OwnedTask`
   - `bun_event_loop::Task::from_boxed` / `ConcurrentTask::create_boxed`
   - `#[js_class]`-generated `T::to_js_boxed` + `host_fn_finalize`
   - `bun_libuv_sys::UvHandle::set_owned_data` / `take_owned_data`
3. **SAFETY comments are present at >95% of sampled raw-pointer sites**,
   often citing Stacked Borrows-level reasoning (Box::into_raw provenance,
   `&mut` reborrow tag invalidation, etc.). The few sites without a comment
   are uniformly `bun_alloc` helper internals or trivially-correct
   `Box::from_raw` reclaims at the tail of a deinit fn.

The cluster is dominated by **per-callback `heap::alloc` → `heap::take`
round-trips** in async I/O (libuv handles, c-ares requests, thread-pool
tasks, JSC promise deferreds). Pairings are correct, and the pattern is
consistent across the runtime.

### Bug findings — total

**Zero confirmed UAFs, zero confirmed double-frees, zero mismatched
allocators.** Six **latent hazards**: TODO-acknowledged synchronization
gaps, manually-managed ownership-transfer patterns with no compile-time
safety net, and one panic-on-unwind path documented but not enforced.

Detailed in the **Latent hazards** section below. None of these are new
findings; all are either explicitly noted in inline TODO comments / port
notes, or are direct ports of pre-existing Zig contract obligations.

### Pattern subclass breakdown

| Subclass                                                       | Count (approx.) | Bug findings |
| -------------------------------------------------------------- | --------------- | ------------ |
| `heap::into_raw` → libuv handle, freed in close cb             | ~85             | 0 confirmed; **L-001** ack'd race |
| `heap::into_raw` → thread-pool task, reclaimed by `run`        | ~60             | 0 |
| `heap::into_raw` → JSC m_ctx, reclaimed by GC `finalize`       | ~120            | 0 |
| `heap::into_raw` → c-ares `arg`, reclaimed by reply cb         | ~30             | 0 |
| `Box::leak` → JS owns via `MarkedArrayBuffer_deallocator`      | ~12             | 0 |
| `Box::leak` → process-lifetime singleton                        | ~25             | 0 |
| `Box::leak` → backing buffer (`Box<[u8]>`/`Box<[u16]>`) for FFI | ~15             | 0; **L-002** brittle |
| `Arc::into_raw`/`from_raw` keepalive across reentrant callback | ~6              | 0 |
| `Arc::into_raw` → JSC hashmap entry; refcount round-trip       | ~5              | 0 |
| `IntrusiveRc::from_raw`/`into_raw` (= `RefPtr::take_ref`/`leak`) | ~30           | 0; **L-003** drop-leak by design |
| `Pin::new_unchecked` / `NonNull::as_ref`/`as_mut`              | 11              | 0 |

---

## Verified pair table

The 15 highest-traffic `heap::into_raw` ↔ `heap::take`/`destroy` pairs, with
file:line evidence for both halves:

| # | Type                                  | `into_raw` site                                                | reclaim site                                                  |
|---|---------------------------------------|----------------------------------------------------------------|---------------------------------------------------------------|
| 1 | `BufferOutputSink` (html_rewriter)    | `src/runtime/api/html_rewriter.rs:784`                         | `src/runtime/api/html_rewriter.rs:953` (via `Self::deref`)    |
| 2 | `Response` (html_rewriter, transform) | `src/runtime/api/html_rewriter.rs:408`                         | `src/runtime/api/html_rewriter.rs:421` (scopeguard `Box::from_raw`) |
| 3 | `Response` (html_rewriter, init)      | `src/runtime/api/html_rewriter.rs:803`                         | `src/runtime/api/html_rewriter.rs:884` (`Box::from_raw` on error) |
| 4 | `uv::Pipe` (Channel.rs)               | adopted via `Box::from_raw` at `Channel.rs:279`                | callback frees via `Box::from_raw` in `Pipe::close_and_destroy` (`libuv.rs:1282`/`1288`) |
| 5 | `uv::Pipe` (SendQueue Windows IPC)    | `src/jsc/ipc.rs:1656`                                          | `src/jsc/ipc.rs:1053` (close cb) / `:1662`/`:1668` (errpath)  |
| 6 | `WindowsWrite` (IPC)                  | `src/jsc/ipc.rs:1470`                                          | `src/jsc/ipc.rs:792` (`WindowsWrite::destroy`, called from `_windows_on_write_complete` and the sync-error path `:1503`) |
| 7 | `SaveTask` (npm manifest)             | `src/install/npm.rs:1254`                                      | `src/install/npm.rs:1232` (thread-pool callback)              |
| 8 | `NapiFinalizerTask`                   | `src/runtime/napi/napi_body.rs:4319`                           | `src/runtime/napi/napi_body.rs:4342` (`run_on_js_thread`)     |
| 9 | `JSPromiseStrong` (napi deferred)     | `src/runtime/napi/napi_body.rs:1627`                           | `src/runtime/napi/napi_body.rs:1644` / `:1664` (resolve/reject) |
|10 | `LifecycleScriptSubprocess`           | `Self::new` (`src/install/lifecycle_script_runner.rs:1192`)    | `Self::destroy` called at `:915`, `:968`, `:1028`, `:1071`, `:1157` |
|11 | `Stream` (h2_frame_parser)            | `src/runtime/api/bun/h2_frame_parser.rs:4435`                  | `src/runtime/api/bun/h2_frame_parser.rs:7565` (deinit walk + `Box::from_raw` per stream) + `:181` (h2_client) |
|12 | `Holder` (DNS uv getaddrinfo)         | `src/runtime/dns_jsc/dns.rs:426`                               | `src/runtime/dns_jsc/dns.rs:411` (`Holder::run` task callback) |
|13 | `Subprocess` (spawnSync)              | `src/runtime/api/bun/js_bun_spawn_bindings.rs:1225`            | `src/runtime/api/bun/js_bun_spawn_bindings.rs:1929` (`Box::from_raw` + `SubprocessT::finalize`) |
|14 | `WindowsNamedPipeListeningContext`    | `src/runtime/socket/Listener.rs:1692`                          | `WindowsNamedPipeListeningContext::deinit` (errpath via scopeguard `:1706`) / `close_pipe_and_deinit` (success path) |
|15 | `RuntimeTranspilerCache::Entry`       | `src/jsc/RuntimeTranspilerCache.rs:1104`                       | `src/jsc/RuntimeTranspilerStore.rs:1001` *and* `src/runtime/jsc_hooks.rs:2700` (both use `cache.entry.take()` so the `Option` cannot be consumed twice) |

Notable secondary pairs:

| Type                                 | `into_raw` site                                              | reclaim site                                                  |
|--------------------------------------|--------------------------------------------------------------|---------------------------------------------------------------|
| `IntrusiveRc<PipeReader>`            | `subprocess/SubprocessPipeReader.rs:134` (heap::into_raw) + `:138` (IntrusiveRc::from_raw adopts the +1) | `PipeReader::deref` → `Box::from_raw` at `Self::deinit`-equivalent destructor |
| `IntrusiveRc<Terminal>`              | `Terminal.rs:442` (heap::into_raw)                           | `Terminal.rs:1911` (`heap::take` inside `deinit_and_destroy`) |
| `IntrusiveRc<TLSSocket>` twin        | `socket_body.rs:2986` (`IntrusiveRc::from_raw(raw)` adopts +1 written via `heap::into_raw` at `:417`) | `TLSSocket::on_close` consumes the +1 (`socket_body.rs:1490-1492`, `:3549-3554`) |
| `Holder<c_ares::struct_any_reply>`    | `dns.rs:3438` (`results.map(heap::into_raw)`)                | `dns.rs:3424` (`heap::take(this)` in `Self::destroy` invoked by on_cares_complete) |
| `TimerObjectInternals` / `ImmediateObject` containers | various (via `EventLoopTimer::tag = …`)         | `__bun_fire_timer` (`runtime/dispatch.rs:931+`) dispatches per-tag through `owner!`, then the per-arm handler decides whether to free (e.g. `TimerObjectInternals::fire` may `deref()`) |
| `bun_test::RefData` (test runner)    | `bun_test.rs:1195` (`IntrusiveRc::into_raw(this_ref)`)       | `bun_test.rs:726` (`IntrusiveRc::from_raw` adopts the +1 carried by the JS promise pointer); scopeguard at `:731` discharges it via `r.deref()` |
| `IntrusiveRc<StaticPipeWriter>`      | `static_pipe_writer.rs:135` (heap::into_raw)                  | `IntrusiveRc::from_raw(this)` at `:169` adopts the construction +1 |

All 15 pairs verified by inspection. No pairing is broken; no pair has a
double-free path or an unbalanced refcount.

---

## Latent hazards (TODO-acknowledged or contract-fragile)

These are **not** new UB findings. Each is documented in code at the site or
recoverable via a `TODO(port)` / `PORT NOTE` comment. They are surfaced here
so the PR-landing order can target them for hardening before any new code
extends them.

### L-001 — `Watcher::shutdown` / `Watcher::thread_main` ownership race

**Files:** `src/watcher/Watcher.rs:240-266` (`shutdown`),
`src/watcher/Watcher.rs:280-327` (`thread_main`).

**Pattern.** Two-phase ownership transfer: `shutdown` reads
`me.watchloop_handle.load()`; if `true`, signals via `running.store(false)`
and leaves the box alive for the watcher thread to free; if `false`, frees
itself. The thread itself frees at `:325` after `watch_loop()` returns —
**unconditionally on the `Ok(())` path** (line 295-304: `watchloop_handle`
is only re-stored to `false` on `Err`, not on `Ok`).

**Soundness gap.** The TODO comment at `:245-246` and `:324` admits:
> "ownership model — Zig allocator.destroy(this); Rust needs heap::take or
> an Arc to make this sound."

There is no documented happens-before between the thread reading `running`
and dispatching the free at `:325` and an outside caller invoking `shutdown`.
If `shutdown` is called *after* `thread_main` exits and frees, the
`me.watchloop_handle.load()` reads freed memory.

**Reachability.** `Watcher::shutdown` is called exactly twice in the tree:
- `src/runtime/bake/DevServer.rs:1118` (DevServer::drop)
- `src/runtime/api/filesystem_router.rs` (similar drop path; not on hot path)

The DevServer's lifetime, in practice, exceeds the watcher thread's. The
window where the thread exits before DevServer drops is extremely narrow but
not zero (and `watchloop_handle == true` on `Ok` is a wider window).

**Recommendation:** wrap `Watcher` in `Arc` (its `&mut self` API is already
mostly behind atomics + a `Mutex`) so the thread holding its half of the
`Arc` keeps the allocation alive until both halves drop. The `Box::into_raw`
→ `Box::from_raw` round-trip would become `Arc::clone` for the thread side.
Documented but not fixed in this audit — track as `L-001` / watcher ownership
race in the consolidated index. Do not reuse the older `pre-existing-ub-1`
label, which now conflicts with other pass-2 numbering.

### L-002 — `WindowsSpawnOptions` no-Drop manually-managed ownership transfer

**Files:** `src/spawn/process.rs:1585-1745` (struct + `deinit` impls);
caller: `src/runtime/shell/subproc.rs:709-723`.

**Pattern.** `WindowsSpawnOptions` holds `WindowsStdio::Buffer(*mut uv::Pipe)`
raw pointers; on success, `spawn_process_windows` reads each
`stdio.data.stream` and does `bun_core::heap::take(...)` to reconstitute the
`Box<uv::Pipe>` into a `WindowsStdioResult::Buffer(Box<uv::Pipe>)` it
returns. The original `WindowsSpawnOptions` still holds the (now-stale) raw
pointer in its `WindowsStdio::Buffer` slot.

The struct deliberately does **not** implement `Drop`:
> "**Not** `Drop`: on the *success* path `spawn_process_windows` transfers
> sole ownership of each pipe into `WindowsStdioResult::Buffer` via
> `heap::take`, leaving the raw pointers in `self` stale. An auto-Drop
> would then double-free." (`process.rs:1712-1716`)

**Soundness gap.** Callers MUST manually call `options.{stdin,stdout,stderr}.deinit()`
on the error path and MUST NOT call it on the success path. Compile-time
enforcement: none. The check is the human reviewer at every call site.

The only in-tree caller (`subproc.rs:716-721`) gets this right (only inside
the `Err` arm of the spawn match). But future callers can silently break
this.

**Recommendation:** introduce a `WindowsSpawnOptionsGuard` newtype with
`Drop` that frees iff a `disarm()` was *not* called on success. Track as
hardening, not a UB candidate.

### L-003 — `RefPtr<T>` has no `Drop`; field-of-struct ownership leaks

**File:** `src/ptr/ref_count.rs:771-794`.

**Pattern.** `RefPtr<T>` (= `bun_ptr::IntrusiveRc<T>`) is the host-language
analogue of `Arc<T>` for the intrusive-refcount mixin types. **It
deliberately has no `Drop` impl** to match the Zig original (Zig has no
destructors). Dropping a `RefPtr` value silently leaks the strong ref it
owns.

Every field of a struct typed `RefPtr<T>` must document at the field site
which owner-method discharges the ref. The doc spells this out:

> "On every path that gives up a `RefPtr` you must explicitly call one of
> `deref` / `into_raw` / `leak`. … Any new struct field of `RefPtr<T>` type
> must document, at the field site, which of its owners' methods
> discharges this obligation."

**Soundness gap.** Pre-existing on the leak side (not the UB side). A
forgotten `deref` in a new error path leaks the strong ref; if `T::destructor`
runs `heap::take(self)`, the leaked ref means the destructor never runs and
the allocation persists for process lifetime. No UAF, no double-free.

**Reachability.** Every `IntrusiveRc<T>`-holding struct (Subprocess,
Terminal, TLSSocket, PipeReader, NewSocket, BunTest::RefData, …). The
codebase consistently uses scopeguards (`scopeguard::guard(refdata, |r|
r.deref())` at `bun_test.rs:731`) or explicit `deref()` calls in deinit
methods to discharge.

**Recommendation:** do **not** add a blanket `Drop` impl as a first move.
`RefPtr`'s no-Drop semantics are intentional and existing code contains many
explicit `deref()` / `leak()` / `into_raw()` hand-offs. A naive `Drop` impl
would turn correctly-explicit paths into double-deref candidates. The safe
remediation is a migration plan:

1. introduce an owning `AutoRefPtr<T>` / `OwnedRefPtr<T>` newtype with `Drop`;
2. migrate one field at a time from `RefPtr<T>` to the owning type;
3. leave raw `RefPtr<T>` as the explicit-transfer type;
4. add a lint/checklist requiring every `RefPtr<T>` field to name its discharge
   method.

Track as leak-ergonomics hardening; not a UB candidate and not a one-PR
mechanical fix.

### L-004 — `host_fn_finalize` panic-unsafety for intrusive refcounts

**File:** `src/jsc/host_fn.rs:610-631`.

**Pattern.** The codegen `finalize` thunk for `#[js_class]` types does:

```rust
pub fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(Box<T>)) {
    let boxed = unsafe { Box::from_raw(this) };
    f(boxed)
}
```

For intrusively-refcounted `T` (where other native code may hold raw
pointers to the same allocation), the user's `f` body **MUST** call
`Box::into_raw(boxed)` / `Box::leak(boxed)` as its FIRST step before doing
any operation that could return early or otherwise skip the intrusive
`deref`. Under Bun's aborting runtime profiles, a Rust panic does not unwind
and therefore does not run `Box` drop; the historical "panic while holding the
Box -> UAF" wording is wrong for those builds. The real contract is broader
and still important: do not let a normal return/error path drop the `Box`
instead of first converting it back to the intrusive ownership protocol.

The contract is documented at the doc-comment (lines 617-620). Inspection
of all 21 `finalize_js_box` / `finalize_js_box_noop` call sites + the
inherent `fn finalize(self: Box<Self>)` shows that every intrusive-refcount
implementor goes through `bun_ptr::finalize_js_box` /
`finalize_js_box_noop`, both of which leak FIRST then run `before` /
deref — i.e. they discharge the obligation centrally.

**Soundness gap.** A future user implementing `fn finalize(self: Box<Self>)`
inherently could forget to call `finalize_js_box*` and write normal code that
drops the `Box` while intrusive ref holders still exist. The compiler cannot
detect this.

**Recommendation:** make `finalize_js_box` / `finalize_js_box_noop` the only
public entry point and add a Clippy lint or compile-time check rejecting a
direct `fn finalize(self: Box<Self>)` body that doesn't call them. Track as
hardening.

### L-005 — `transform_` html_rewriter `_resp_guard` panic-safety

**File:** `src/runtime/api/html_rewriter.rs:408-422`.

**Pattern.** A `Response` is allocated via `heap::into_raw`, then wrapped
in a `scopeguard::guard(resp, |r| { Response::finalize(Box::from_raw(r)) })`.
The guard ALWAYS runs at scope exit. The function then calls
`self.begin_transform(global, resp)?` which takes `resp` by raw pointer
(no ownership transfer — `begin_transform` only reads `resp`).

Verified: `begin_transform` → `BufferOutputSink::init` takes
`original: *mut Response` and only reads via `(*original).get_body_len()`
etc.; never deallocates. The result-`Response` it produces is a separate
allocation at `html_rewriter.rs:803`. So the scopeguard at line 418 is the
sole owner of `resp` — correct.

**Soundness gap.** Brittle to a future refactor: if `begin_transform` ever
takes ownership of `resp` (e.g. moves it into the sink), the scopeguard
would double-free. The comment at `:419` does name `resp` as the
allocation, but there's no compile-time check.

**Recommendation:** change the contract so `BufferOutputSink::init` returns
the `original` pointer (unowned) and the caller's scopeguard owns the only
free. Or wrap `resp` in a typed `OwnedResponse(NonNull<Response>)` with
`Drop`. Track as hardening.

### L-006 — `cache.entry` two-consumer reclaim (RuntimeTranspilerCache)

**Files:** `src/jsc/RuntimeTranspilerCache.rs:1104` (producer);
`src/jsc/RuntimeTranspilerStore.rs:997-1001` and
`src/runtime/jsc_hooks.rs:2693-2700` (two consumers).

**Pattern.** A cache hit produces `this.entry = Some(heap::into_raw(Box::new(entry)).cast::<()>())`
(type-erased `*mut ()`). Two distinct consumers reclaim via
`cache.entry.take()` followed by `heap::take(entry_ptr.cast::<CacheEntry>())`.

Verified: both consumers use `Option::take` to clear the slot atomically,
so even if both reachable from the same control-flow, only the first run
gets `Some`. **No double-free path.**

**Soundness gap.** None observed. The slight risk is a path where
`cache.entry` is set but no consumer is ever reached → leak. (Acceptable;
not UB.)

**Recommendation:** none required; track only as documentation. (The
`Option<*mut ()>` would be cleaner as `Option<NonNull<()>>` with a typed
sibling fn for the cast; that's the (C) refactor.)

---

## Per-subclass analysis with representative sites

### Subclass 1 — libuv handle `heap::alloc` → close-callback `heap::take`

The libuv pattern is the largest single source of `heap::*` calls (~85
sites). The canonical shape:

```rust
// allocation site
let handle: *mut uv::Pipe = bun_core::heap::into_raw(Box::new(
    bun_core::ffi::zeroed::<uv::Pipe>()
));
unsafe { (*handle).init(loop_, ...) };

// later: hand to libuv via uv_close + close cb
unsafe { uv::Pipe::close_and_destroy(handle) };

// inside libuv.rs:1280
extern "C" fn on_close_destroy(handle: *mut Pipe) {
    drop(unsafe { Box::from_raw(handle) });
}
```

Verified sites (sampled):

- `src/jsc/ipc.rs:1656` (alloc) ↔ `src/jsc/ipc.rs:1053` (close cb `_windows_on_closed`)
- `src/runtime/api/bun/subprocess.rs:1199` (`Box::leak` → close cb) ↔ `src/runtime/api/bun/subprocess.rs:1459` (`on_pipe_close` via `heap::take`)
- `src/spawn/process.rs:1549`/`:1555` (`close_and_destroy(Box::into_raw(pipe))`) — close cb is `on_close_destroy` in `libuv.rs:1280`
- `src/runtime/cli/test/parallel/Channel.rs:219`,`:226`,`:442`,`:517`,`:632` — all variants use `Pipe::close_and_destroy`
- `src/install/PackageManager/security_scanner.rs:1228` — close-and-destroy on error path
- `src/runtime/socket/WindowsNamedPipe.rs:225`,`:1409` — same
- `src/event_loop/SpawnSyncEventLoop.rs:276` (`on_close_uv_timer` close cb) ↔ `:380` (`heap::into_raw_nn` allocation in `prepare_timer_on_windows`)

**Caveat.** `Pipe::close_and_destroy` (libuv.rs:1279-1295) has a documented
edge case: if a non-freeing close-cb was previously registered (i.e. the
pipe is already in the `is_closing()` state), the freshly-passed `this` is
**not** reclaimed — the prior close-cb is assumed to free it. The doc names
this:

> "if a non-freeing callback was registered, the pipe leaks."

This is a leak hazard, not UB. Single in-tree edge.

### Subclass 2 — thread-pool task `heap::into_raw` → callback `heap::take`

Sampled sites:

- `src/install/npm.rs:1254` (`SaveTask::new` → `heap::into_raw`) ↔
  `:1232` (callback `SaveTask::run` recovers via `IntrusiveWorkTask::from_task_ptr`
  + `heap::take`)
- `src/threading/work_pool.rs:174` (`schedule_owned` does the single
  `Box::into_raw` for every `OwnedTask`) ↔ `:66` (`__callback` reclaims via
  `Box::from_raw(Self::from_task_ptr(task))`)
- `src/threading/work_pool.rs:207` (`WorkPool::go` open-codes the
  round-trip for type-erased contexts) ↔ `:202` (callback frees)
- `src/install/PackageManager/runTasks.rs:216`,`:1803`,`:1882` — all paired

`WorkPool::schedule_owned` / `OwnedTask` is the **typed wrapper** that
should be preferred. `SaveTask` predates it and could be migrated; tracked
as (C) refactor (see `B-001-and-B-002-perf-only.md`).

### Subclass 3 — JSC m_ctx `heap::into_raw` → GC-finalizer `heap::take`

Largest subclass (~120 sites). Centralized via codegen + `host_fn_finalize`:

- Construction: codegen `${T}Class__construct` calls `IntoHostConstructReturn`
  which is `Box::into_raw` of the constructor's return value (`src/jsc/host_fn.rs:622-631`
  + class-specific construct impl).
- Finalization: codegen `${T}Class__finalize` calls
  `host_fn_finalize(this, |b| T::finalize(b))`. For intrusive-refcounted
  `T`, the user's `T::finalize` calls `bun_ptr::finalize_js_box*` which
  leaks first then derefs. For non-refcounted `T`, the `Box<T>` drops
  on scope exit.

21 in-tree `finalize_js_box*` call sites verified (PostgresSQLQuery,
JSMySQLQuery, JSMySQLConnection, CronJob, Terminal, h2_frame_parser,
NodeHTTPResponse, HTMLBundle, BlockList, JSTranspiler, …) — each pairs
with the matching `m_ctx` construction in a `to_js` / constructor path.

### Subclass 4 — c-ares request `heap::alloc` → reply callback `heap::take`

~30 sites in `src/runtime/dns_jsc/dns.rs`. Standard shape:

- `dns.rs:693`, `:842`, `:949`, `:1103`, `:1436`, `:1737`, `:2001`, `:2327`,
  `:3686` — all `let request = bun_core::heap::into_raw(Box::new(Self { ... }))`
- The reply callbacks all invoke `Self::on_cares_complete(self_ptr, ...)` /
  `Self::on_libuv_complete(...)` which internally call
  `Self::destroy(this) → heap::take(this)` at the end.

`Holder` (Windows getaddrinfo wrapper, `:403-447`) is the only one that
allocates twice: once for the outer `GetAddrInfoRequest` (`:949`-style) and
once for the inner `Holder` (`:426`). Both have matched takes.

### Subclass 5 — `Box::leak` → JSC owns via `MarkedArrayBuffer_deallocator`

12 sites. `MarkedArrayBuffer_deallocator` is the JSC-side function that
calls `mi_free` on the leaked allocation when the JS ArrayBuffer is GC'd.

- `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:322` (leak →
  `MarkedArrayBuffer::from_bytes(slice, JSType::Uint8Array)`)
- `src/runtime/node/node_fs.rs:2416`, `:2458` (leak → ArrayBuffer)
- `src/runtime/api/bun/Terminal.rs:1847` (leak → ArrayBuffer)
- `src/sys/lib.rs:7429` (leak'd C string for `argv` allocation; documented
  as process-lifetime by the comment)

The preferred replacement is `JSValue::create_buffer_from_owned_box`
(`src/jsc/JSValue.rs:605`), which takes a `Box<[u8]>` by value and
internally does the leak — no `unsafe`. ~5 of the 12 sites could be migrated;
the others are inside the `MarkedArrayBuffer` constructor's required
`&'static mut [u8]` form. Tracked as (C) refactor.

### Subclass 6 — `Box::leak` → process-lifetime singleton

~25 sites. The PORTING.md `§Forbidden patterns` rule bans `Box::leak` to
mint `&'static`, but the in-tree exceptions are explicit:

- `src/sys/windows/env.rs:72`, `:92` (process-lifetime envp/wtf8 buffers
  for `GetEnvironmentStringsW` import)
- `src/clap/comptime.rs:380`, `:421`, `:423` (CLI arg-spec tables built
  once at startup; never freed)
- `src/jsc/static_export.rs:32` (the comment explicitly notes
  "`Box::leak` is forbidden per docs/PORTING.md" and uses a different
  pattern; the leak'd one here is the documented exception)
- `src/jsc/TopExceptionScope.rs:71` (leaked C string for the JSC
  exception-name registry; documented)
- `src/ptr/lib.rs:424` (`Interned(Box::leak(b))` — interner cache; values
  are intentionally process-lifetime)
- `src/bun_core/heap.rs:80`, `:112`, `:120` (the helpers themselves; the
  caller's allocation is what's actually leaked, not these meta-helpers)

These are sound by construction (never freed, no Drop hazard). Many have
`PORTING.md §Forbidden`-citing comments explaining why they're the
exception.

### Subclass 7 — `Box::leak` → backing buffer for FFI

~15 sites where a `Box<[u8]>` or `Box<[u16]>` is leaked so a C API can hold
a raw pointer into it for a known duration, then the buffer is reclaimed by
a paired free fn. This is L-002 territory — manually-managed lifetime.

- `src/http/HTTPThread.rs:521` (`heap::release` of `NewHttpContext`) +
  paired reclaim in the global context cache's eviction path
- `src/runtime/webcore/blob/write_file.rs:959` (`Box::leak` of
  `AsyncMkdirp` for a worker-thread async fs op; reclaimed by the worker's
  done callback)

All sampled sites use `heap::release` (the named "hand-off to non-Box
owner" spelling) and include a SAFETY comment naming the reclaim site. The
unsafety is in the unnamed-by-the-compiler invariant that the foreign owner
WILL reclaim — sound when honored.

### Subclass 8 — `Arc::into_raw`/`from_raw` keepalive across reentrant callback

6 sites — concentrated in:

- `src/runtime/shell/subproc.rs:2099-2105` (`PipeReader::guard_from_raw`:
  `Arc::increment_strong_count` + `Arc::from_raw` to materialize an owned
  `Arc<Self>` from a stored raw pointer, holding a +1 for the duration of a
  re-entrant `Cmd::buffered_output_close` call)
- `src/runtime/dispatch.rs:1051-1057` (BunTest timer arm: same pattern)

Both use `Arc::increment_strong_count` BEFORE `Arc::from_raw` (so the
materialized Arc doesn't steal the stored ref), then either return the new
Arc or `Arc::into_raw` the original back to discharge the temporary clone.
**Refcount balance correct.**

### Subclass 9 — `Arc::into_raw` → JSC hashmap entry; refcount round-trip

5 sites — all in `src/jsc/SavedSourceMap.rs` (`:413`, `:425`, `:444`, `:469`,
`:495`):

```rust
// stores +1 ref into the table
*mapping = Value::init(Arc::into_raw(Arc::clone(&result))).ptr();
// retrieves with a bumped count for the caller's handle
unsafe {
    Arc::increment_strong_count(parsed.cast_const());
    Arc::from_raw(parsed.cast_const())  // both sides hold their own +1
}
```

When `put_value` replaces an existing entry, it releases the prior ref via
`ParsedSourceMap::deref` (`SavedSourceMap.rs:361`), which forwards to
`Arc::decrement_strong_count(this.cast_const())` in
`src/sourcemap/ParsedSourceMap.rs:242`. **Refcount balance correct;
allocator-mismatch hazard discussed below is solved.**

`ParsedSourceMap::deref`/`::ref_` explicitly forbid the open-coded
`heap::take` route, because the table-stored pointer is an `Arc::into_raw`
result (i.e. points at the **inner data**, not the Arc header) — using
`Box::from_raw` on it would trip `mi_validate_block_from_ptr` in mimalloc
free.c:123. The doc comment at `ParsedSourceMap.rs:217-219` calls this out
explicitly. **This is the canonical example of how the audit catches a
mismatched-allocator hazard before it becomes a bug.**

### Subclass 10 — `IntrusiveRc::from_raw`/`into_raw`

`IntrusiveRc<T>` is a type alias for `RefPtr<T>`. `IntrusiveRc::from_raw`
adopts an existing +1 ref WITHOUT incrementing the count;
`IntrusiveRc::into_raw` gives up ownership without decrementing. The pair
is symmetric so refcount-balanced. The 30+ sites that use this pattern are:

- Subprocess: `js_bun_spawn_bindings.rs:786,1226-1279` (constructor returns
  `IntrusiveRc::into_raw(result.terminal)` to JS as m_ctx, then the JS
  wrapper's finalize gets the raw pointer back via `host_fn_finalize` and
  the user's `fn finalize` calls `finalize_js_box(self, ...)`)
- Terminal: `Terminal.rs:574` (adopt) ↔ `:604` (release as m_ctx)
- TLSSocket twin: `socket_body.rs:2986` (adopt the construction +1) ↔
  on_close consumes the +1
- StaticPipeWriter: `static_pipe_writer.rs:169` (adopt construction +1)
- BunTest RefData: `bun_test.rs:1195` (release into JS promise pointer) ↔
  `:726` (adopt back); scopeguard at `:731` discharges
- SubprocessPipeReader: `SubprocessPipeReader.rs:138` (adopt construction +1)

All paired. Refcount balance verified by inspection.

### Subclass 11 — `Pin::new_unchecked` / `NonNull::as_ref`/`as_mut`

11 `NonNull::as_ref`/`as_mut` sites surveyed:

- `src/jsc/AbortSignal.rs:200` — `NonNull::new(ptr).map(|p| p.as_ref())`,
  pointer is C-side AbortSignal kept alive by ref(); sound.
- `src/jsc/web_worker.rs:948` — `NonNull::new(std::ptr::from_mut(a.as_mut().unwrap()))`,
  reborrow of `&mut` via `JsCell::with_mut`; reborrowed pointer captures the
  `&mut` provenance for the lifetime of the returned NonNull. Sound.
- `src/bun_core/external_shared.rs:93` — `self.ptr.as_ref()`; pointer is
  the C-side string impl which outlives `self` by ext-refcount. Sound.
- `src/bun_core/fmt.rs:474` — `self.ptr.as_mut()`; the only mut borrow of
  the inner buffer in this scope. Sound.
- `src/bun_alloc/lib.rs:3115`, `:3120` — process-lifetime BSS-style singleton
  map; `&self`/`&mut self` provenance forwards to the inner map. Sound.
- `src/jsc/AsyncModule.rs:1323` — `printer_ptr.as_mut()` on a thread-local
  Box-leaked printer; single-thread access. Sound.
- `src/uws_sys/thunk.rs:151`, `:236` — `p.as_mut()` on user-data slot; same
  pattern as `UvHandle::take_owned_data`. Sound.

**No `NonNull::as_ref` aliasing UB found.** All sites have the pointee held
alive by a documented mechanism (refcount, ext-refcount, process-lifetime,
single-thread thread-local, or scope-bound `&mut self`).

---

## Hardening recommendations (SAFETY-comment templates per pattern)

Per the existing skill's `safety-comment-template`, the audit recommends:

### Template 1 — libuv handle (alloc + close-cb pair)

At the allocation site:

```rust
// SAFETY: `handle` is freshly Box-allocated (refcount/ownership 1); we
// transfer ownership to libuv by passing `handle` to `uv_pipe_init`. The
// matching free is `<callback_name>` (file:line), registered via `uv_close`
// below; it reconstructs the Box via `Box::from_raw` and drops it.
let handle: *mut uv::Pipe = bun_core::heap::into_raw(Box::new(...));
```

At the close cb:

```rust
extern "C" fn on_close_destroy(handle: *mut Pipe) {
    // SAFETY: `handle` was Box-allocated at <site>; libuv guarantees the
    // close callback fires exactly once. No other ref holders alias the
    // allocation at this point.
    drop(unsafe { Box::from_raw(handle) });
}
```

### Template 2 — thread-pool task

Prefer `WorkPool::schedule_owned` / `OwnedTask` (no SAFETY comment needed
at call sites; the obligation is centralized in `__callback`).

### Template 3 — JSC `to_js` / `finalize` (intrusive-refcount)

```rust
// to_js side: the construct path's `Box::into_raw` transfers the caller's
// +1 to the JS wrapper's m_ctx slot. The matching deref is in `finalize`
// below.

pub fn finalize(self: Box<Self>) {
    bun_ptr::finalize_js_box(self, |this| {
        // pre-deref work on a &T borrow (no &mut — other ref holders may alias)
    });
}
```

### Template 4 — `Box::leak` → JS ArrayBuffer

Migrate to `JSValue::create_buffer_from_owned_box(box)` if the call shape
fits; otherwise:

```rust
// SAFETY: `leaked` is freshly Box::leak'd; ownership transfers to the JS
// MarkedArrayBuffer which frees via `MarkedArrayBuffer_deallocator` (mi_free)
// on GC. The leak's matching free is the GC finalizer.
let leaked: &'static mut [u8] = Box::leak(buffer);
MarkedArrayBuffer::from_bytes(leaked, jsc::JSType::Uint8Array)
```

### Template 5 — `Arc::into_raw` keepalive across reentrant callback

```rust
// Bump the strong count BEFORE materializing an owned Arc — the +1 we
// snapshot below must not steal from the stored ref. The materialized Arc
// drops at scope exit, releasing our temporary +1.
let strong: Arc<T> = unsafe {
    Arc::increment_strong_count(stored_raw_ptr);
    Arc::from_raw(stored_raw_ptr)
};
// ... use strong across the reentrant call ...
drop(strong); // matches the +1 above
```

### Template 6 — `WindowsSpawnOptions`-style manually-managed transfer

Introduce a typed `OwnedTransferGuard<T>` that wraps the raw pointer and:
- runs `heap::take` on `Drop` if not disarmed
- has a `disarm() -> *mut T` method that returns the raw pointer and skips
  the drop (called on successful ownership transfer)

This converts L-002-style hazards from "human-reviewer-enforced" to
"compile-time-enforced" without code-size impact.

---

## PR-landing order

1. **L-006 (zero-risk doc-only)** — Add `cache.entry: Option<NonNull<()>>`
   typed sibling. Already sound; this is pure ergonomics.

2. **L-004 (low-risk, codegen-only)** — Lint or compile-time check that
   `fn finalize(self: Box<Self>)` impls go through `finalize_js_box*`. No
   behavior change.

3. **L-005 (low-risk, single file)** — Convert the `html_rewriter`
   `transform_` scopeguard pattern to a typed `OwnedResponse(NonNull<Response>)`
   newtype with `Drop`. Single-site, no API impact.

4. **L-002 (medium, ABI of `WindowsSpawnOptions`)** — Introduce
   `WindowsStdioBufferGuard` newtype that wraps `*mut uv::Pipe` and frees
   on drop unless `disarm()`'d. Migrate `WindowsSpawnOptions` field-by-field.
   Touches `bun_spawn` + `bun_runtime`.

5. **L-003 (medium, RefPtr ergonomics)** — Introduce an owning `AutoRefPtr<T>`
   newtype with `Drop`; migrate fields one at a time. Do not add blanket Drop
   to existing `RefPtr<T>`.

6. **L-001 (large, Watcher ownership refactor)** — Convert `Watcher` to
   `Arc<Watcher>` with the watcher thread holding its own clone. The
   current `Box<Watcher>` field on `DevServer` becomes
   `Arc<Watcher>`; the spawned thread captures a clone instead of the raw
   pointer. Touches `bun_watcher` + `bun_runtime`.

---

## Pass-2 verdict

**The Bun raw-pointer-lifecycle surface is well-engineered.** The audit
sampled ~110 sites (every site in the smart_ptr_raw category, plus the top
20 bun_heap_lifecycle sites per crate for the 8 crates with >5 entries),
plus traced the 15 highest-traffic into_raw/take pairs end-to-end, plus
verified the `Pipe::close_and_destroy` documented edge case, plus
investigated the 6 latent hazards (L-001 through L-006) flagged here.

**Zero confirmed UB candidates were produced by this pass.** The six latent
hazards are all either TODO-acknowledged in code or contract-fragile
patterns that the audit recommends hardening via typed wrappers — not UB
bugs requiring an immediate `pre-existing-ub-N` bead.

**Comparison to A-001 (Zig-port `&mut self` audit).** A-001 found zero
confirmed UB and a similar pattern of "documented invariants, mostly
upheld, with a small number of hardening targets". This audit corroborates
that finding for the heap-round-trip surface. The two structural
invariants I-001 (pointer-provenance at FFI callback boundaries) and I-005
(MimallocArena non-Drop semantics) account for >80% of why the unsafe is
necessary; the rest is JSC GC integration (I-002, I-003, I-004) and the
allocator-vtable interactions (I-007, I-014).

---

## Appendix A — Sites surveyed (by file:line)

The following 110 sites were read in full context (≥20 lines surrounding):

```text
src/bun_core/heap.rs:34,44,51,79,90,101,109,119
src/bun_alloc/lib.rs:2352,2441,2354
src/ast/lib.rs:3313
src/ast/new_store.rs:194
src/ast/nodes.rs:67
src/collections/hive_array.rs:452,535,586,596,628
src/collections/pool.rs:379,446
src/event_loop/ConcurrentTask.rs:322,324
src/event_loop/ManagedTask.rs:30
src/event_loop/SpawnSyncEventLoop.rs:253,276,380
src/event_loop/MiniEventLoop.rs:178
src/http/AsyncHTTP.rs:395
src/http/HTTPThread.rs:521,1027
src/http/h2_client/ClientSession.rs:181
src/http/h3_client/ClientSession.rs:171
src/http/h3_client/ClientContext.rs:93
src/http/h3_client/PendingConnect.rs:84
src/http/lib.rs:166,173,3405
src/http_jsc/websocket_client.rs:2014,2211
src/install/lifecycle_script_runner.rs:1125,1129,1199,1201
src/install/npm.rs:1232,1254
src/install/PackageInstall.rs:628,639,741
src/install/PackageManager.rs:801,825,839
src/install/PackageManager/PackageManagerEnqueue.rs:1778
src/install/PackageManager/runTasks.rs:216,1803,1882
src/install/PackageManager/security_scanner.rs:1228,1292
src/install/TarballStream.rs:173,213
src/install/patch_install.rs:164,166
src/io/PipeReader.rs:1346,1839,1850
src/io/PipeWriter.rs:1297,1357,1379,1390
src/jsc/AbortSignal.rs:404,406
src/jsc/AsyncModule.rs:791,1323
src/jsc/ConcurrentPromiseTask.rs:130,133
src/jsc/DeprecatedStrong.rs:79
src/jsc/SavedSourceMap.rs:413,423-425,444,469,495
src/jsc/RuntimeTranspilerStore.rs:485,489,997-1001
src/jsc/RuntimeTranspilerCache.rs:1104
src/jsc/event_loop.rs:579,596,1323
src/jsc/hot_reloader.rs:650,652
src/jsc/host_fn.rs:622-631
src/jsc/HTTPServerAgent.rs:112
src/jsc/ipc.rs:792,1053,1470,1478,1503,1590,1656,1662,1668
src/jsc/virtual_machine_exports.rs:168
src/jsc/VirtualMachine.rs:2813,6300
src/jsc/web_worker.rs:625,948,1305,1309
src/jsc/webcore_types.rs:175-183,1156
src/libuv_sys/libuv.rs:557,585-608,1279-1295
src/ptr/ref_count.rs:110-115,177-202,680-715,800-885
src/ptr/parent_ref.rs:231
src/ptr/shared.rs:100-188
src/ptr/lib.rs:71,418-424
src/runtime/api/Archive.rs:754
src/runtime/api/bun/h2_frame_parser.rs:4435,7563-7601
src/runtime/api/bun/js_bun_spawn_bindings.rs:786,1225-1279,1929
src/runtime/api/bun/SSLContextCache.rs:198,214,235,295
src/runtime/api/bun/spawn/stdio.rs:650
src/runtime/api/bun/subprocess.rs:1183-1213,1456-1460
src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:134-138,322
src/runtime/api/bun/Terminal.rs:442,554-576,604,1880-1912
src/runtime/api/cron.rs:325-357,1099-1101,1372-1382
src/runtime/api/html_rewriter.rs:343-348,408-470,778-980
src/runtime/api/filesystem_router.rs:862
src/runtime/bake/DevServer.rs:1117-1118,6502-6526
src/runtime/cli/test/parallel/Channel.rs:219-226,279,442,517,632
src/runtime/cli/test/parallel/Worker.rs:205
src/runtime/crypto/CryptoHasher.rs:154,773-780
src/runtime/dispatch.rs:899-1075
src/runtime/dns_jsc/dns.rs:411-447,693,842,949,1103,1436,1737,1843,2001,2327,2363-2370,3422-3441,3686,3989-4006
src/runtime/napi/napi_body.rs:1617-1672,2805,4292-4352
src/runtime/node/fs_events.rs:1009
src/runtime/node/node_fs.rs:740-1073,1395-1466,1693-1888,2400-2470,2700-2745
src/runtime/node/node_zlib_binding.rs:832
src/runtime/server/HTMLBundle.rs:127,734,850
src/runtime/server/NodeHTTPResponse.rs:1898-1945
src/runtime/shell/dispatch_tasks.rs:38-120
src/runtime/shell/IOReader.rs:85-94
src/runtime/shell/IOWriter.rs:195-315,1055-1070
src/runtime/shell/RefCountedStr.rs:33-66
src/runtime/shell/subproc.rs:709-723,2085-2138,2349
src/runtime/shell/interpreter.rs:1633
src/runtime/socket/Listener.rs:241,330,815,1683-1716
src/runtime/socket/socket_body.rs:1461-1520,2986,3492-3556,3565-3617,3853-3860
src/runtime/socket/udp_socket.rs:485,1701-1718
src/runtime/socket/WindowsNamedPipe.rs:199-225,646,1405-1410
src/runtime/test_runner/bun_test.rs:715-753,1185-1205
src/runtime/valkey_jsc/js_valkey.rs:1717-1742
src/runtime/webcore/FileReader.rs:980-993
src/runtime/webcore/Request.rs:855-874
src/runtime/webcore/ReadableStream.rs:915-952,1199-1210
src/sourcemap/ParsedSourceMap.rs:209-243
src/spawn/process.rs:1530-1700,1815-2252,2750-2790
src/spawn/static_pipe_writer.rs:129-180
src/sys/windows/env.rs:55-100
src/threading/work_pool.rs:51-218
src/watcher/Watcher.rs:226-327
```

## Appendix B — Tooling reproducibility

Inventory regenerated from:

```bash
jq -c 'select((.categories | index("bun_heap_lifecycle")) // (.categories | index("smart_ptr_raw")))' \
    .unsafe-audit/unsafe-inventory.jsonl > /tmp/audit-A-002.jsonl
```

Per-crate breakdown:

```bash
jq -c '...' | jq -r '.crate' | sort | uniq -c | sort -rn
```

Pair counts:

```bash
rg -n 'heap::(into_raw|alloc|alloc_nn|into_raw_nn|release|leak)\b' src/ --type rust | wc -l
# → 982
rg -n 'heap::(take|destroy)\b' src/ --type rust | wc -l
# → 538
rg -n 'Box::into_raw\b' src/ --type rust | wc -l
# → 62
rg -n 'Box::from_raw\b' src/ --type rust | wc -l
# → 51
rg -n 'Arc::(into_raw|from_raw|increment_strong_count|decrement_strong_count)\b' src/ --type rust | wc -l
# → 23
```
