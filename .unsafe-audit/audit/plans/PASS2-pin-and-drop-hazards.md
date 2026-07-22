# PASS-2 — Pin Projection Soundness and Drop-Path Hazards

**Scope.** Four orthogonal hazard classes seeded by Pass-1 priors:

1. `Pin::new_unchecked` / `map_unchecked_mut` projection soundness.
2. Panic-in-`Drop` (UB under unwind, availability hazard under abort).
3. Async / task-cancellation paths that leak invariants when the host
   drops a task before completion.
4. `!Send` payloads (notably `bun_jsc::Strong` / `Weak`) being dropped on
   the wrong thread because their owner crossed a thread boundary.

**Methodology.**

1. Enumerated every Pin construction site in `src/`:
   `Pin::new_unchecked`, `Pin::new`, `pin_mut!`, `pin::pin!`,
   `map_unchecked`, `map_unchecked_mut`, `Box::into_pin`.
2. Enumerated every `impl Drop` (`rg 'fn drop'` → 314 sites across 297
   files) and classified the body via an AST-aware sweep
   (`/tmp/dropfn_panic_v3.py`) for panic-prone calls (`.unwrap()`,
   `.expect()`, `panic!`, `unreachable!`, `assert!`, `assert_eq!`,
   `assert_ne!`, `todo!`, `unimplemented!`), filtering out
   `debug_assert*!` and `cfg(debug_assertions)` blocks.
3. Separately swept for FFI calls in Drop, lock acquisitions in Drop, and
   heap allocations in Drop.
4. Audited every `unsafe impl Send` (64 hits) for proximity to types that
   contain `bun_jsc::Strong` / `Weak` / `JSPromiseStrong` / `StrongOptional`.
5. Inspected the canonical cross-thread task lifecycles:
   `ConcurrentPromiseTask`, `FetchTasklet`, `JSBundleCompletionTask`,
   `Subprocess`, `Watcher::thread_main`, `Debugger`.

**Build-profile prior — this changes the calculus.** `Cargo.toml` sets
`panic = "abort"` for `release`, `dev`, and `shim`. It does **not** define
`[profile.test]`; plain `cargo test` should not be described as using the
same panic strategy unless it is explicitly routed through Bun's build profile.
There are zero `extern "C-unwind"` declarations. The runtime panic hook
in `src/crash_handler/lib.rs:1801` calls
`std::process::abort()` after printing diagnostics; the comment at
`src/crash_handler/lib.rs:1804-1814` even installs a re-entry guard for
double-panic in the hook itself ("Aborting").

Consequences for this audit:

- **Panic-in-Drop is NOT a UB hazard in Bun's runtime profiles.** `panic =
  "abort"` means a panic never starts unwinding; the abort signal is
  raised synchronously and Drop bodies do not run during a panic. The
  Rust nomicon's "panic-during-unwind -> abort" rule and "panic across
  FFI -> UB" rule both require unwinding to be enabled. They cannot fire
  in `bun bd` / dev / release builds.
- **Panic-in-Drop is still an availability hazard.** Any panic in a Drop
  body aborts the whole Bun process. For a runtime, that is a DoS, not
  a UB: an attacker who can drive a request flow into a panicking Drop
  takes the server down. Severity is C (correctness/availability), not
  A (UB).
- **`Mutex` poisoning is moot for runtime builds.** `bun_core::util::Mutex` is
  a poison-free wrapper around `std::sync::Mutex` (`src/bun_core/util.rs`);
  runtime panics abort rather than unwind through guard release.

This memo classifies every hit against this prior. Where the prior
fully discharges a hazard, I say so explicitly rather than handwaving.

---

## Executive Summary

| Hazard class                          | Sites investigated | Real UB | Availability bugs | False alarms |
| ------------------------------------- | ------------------ | ------- | ----------------- | ------------ |
| `Pin::new_unchecked` projection       | 0 (none in tree)   | 0       | 0                 | n/a          |
| `Box::into_pin` / self-ref pinned     | 1                  | 0       | 0                 | 1            |
| Panic in `Drop` (non-debug)           | 6                  | 0       | 2                 | 4            |
| Lock acquisition in `Drop`            | 3                  | 0       | 0                 | 3            |
| FFI call in `Drop`                    | 14                 | 0       | 0                 | 14           |
| Cross-thread task drop (Strong)       | 5 paths            | 0       | 0                 | 5            |
| Send-violation through Drop           | 64 `unsafe impl`   | 0       | 0                 | 64           |

**Headline finding.** No new UB. Two availability hazards worth filing as
low-priority hardening tickets. The Pin surface is essentially empty —
Bun has not adopted the Pin-based async idiom; it pins heap allocations
informally by leaking `Box<T>` and never moving them, with manual SAFETY
discipline at every call site. This is sound but means Pin-projection
bugs are categorically absent.

**Recommended PRs.**

1. **CODEX-P2-drop-availability** — replace two `expect()` calls in Drop
   bodies (`bun.rs:860` `fchdir`, `MySQLRequestQueue.rs:355` `NonNull::new`)
   with diagnostic logging plus best-effort recovery. Severity: C.
2. **No PRs for Pin / cross-thread Drop**. Existing patterns are sound.

---

## Section 1 — Pin Projection Soundness

### 1.1 Surface scan

```sh
rg 'Pin::new_unchecked|pin_unchecked|map_unchecked|map_unchecked_mut|Pin::new\(|pin_mut!|pin::pin!' src/ --type rust
```

**Result: 0 occurrences.**

```sh
rg 'Box::into_pin|core::pin::Pin<|std::pin::Pin<|pin::Pin<' src/ --type rust
```

**Result: 1 production call site** (`src/jsc/ConsoleObject.rs:173`,
`Box::into_pin(out)`) plus four doc-comments referencing future
"Phase B: Pin<Box<Self>>" porting work
(`src/bundler/bundled_ast.rs`,
`src/event_loop/SpawnSyncEventLoop.rs:`,
`src/runtime/cli/filter_arg.rs`).

```sh
rg 'PhantomPinned' src/ --type rust | rg -v 'use core::marker'
```

**Result: ~25 occurrences**, every single one of which is a
`PhantomPinned` field embedded in an opaque FFI handle type
(`uws_sys::App`, `uws_sys::WebSocket`, …, `tcc_sys::TCCState`,
`brotli_sys::Encoder`, `cares_sys::Channel`, etc.). The `PhantomPinned`
here is the canonical opaque-pointer marker emitted by the
`bun_opaque::opaque_ffi!` macro (`src/opaque/lib.rs`). It exists to make
the type `!Unpin` so callers cannot accidentally form `&mut T` and move
the foreign object out from under the C side. **It is not exercised by
any Pin projection** — Bun only ever holds these as raw pointers (`*mut
uws::App`, etc.); a `Pin<&mut uws::App>` is never constructed.

### 1.2 Sole real Pin site — `ConsoleObject::init`

`src/jsc/ConsoleObject.rs:146-174`:

```rust
pub fn init(
    error_writer: Output::StreamType,
    writer: Output::StreamType,
) -> core::pin::Pin<Box<ConsoleObject>> {
    let mut out = Box::new(ConsoleObject {
        stderr_buffer: [0; 4096],
        stdout_buffer: [0; 4096],
        error_writer_backing: Output::QuietWriterAdapter::uninit(),
        writer_backing: Output::QuietWriterAdapter::uninit(),
        default_indent: 0,
        counts: Counter::default(),
        _pin: core::marker::PhantomPinned,
    });
    let p: *mut ConsoleObject = &raw mut *out;
    unsafe {
        (*p).error_writer_backing = error_writer
            .quiet_writer()
            .adapt_to_new_api(&mut (*p).stderr_buffer);
        (*p).writer_backing = writer
            .quiet_writer()
            .adapt_to_new_api(&mut (*p).stdout_buffer);
    }
    Box::into_pin(out)
}
```

**Verdict: CORRECT, but unused.** The whole `init` function is
documented as the preferred API (line 144) but is never called. The
actual VM init path uses the unpinned out-param twin `init_in_place`
(`src/jsc/VirtualMachine.rs:2011-2017`). The contract for
`init_in_place` is documented at the function: "The address of `*out`
MUST be stable for the value's entire lifetime — moving it afterwards
leaves the writer adapters dangling. Prefer `init` for new code."

VM uses `Box::<MaybeUninit<ConsoleObject>>::new` → `init_in_place(&mut
console_box, …)` → `heap::into_raw(console_box)` → stores raw `*mut`.
The struct's address is fixed at the `Box::new` allocation point and
never moves. **Sound by construction**, but the safety is informal —
identical to "leak a `Box` and never move it" — rather than enforced by
`Pin<Box<T>>`.

`Box::into_pin(out)` is safe: `Box<T>` has stable address semantics, and
the standard library provides `From<Box<T>> for Pin<Box<T>>` and
`Box::into_pin` precisely for this purpose. No `unsafe` involved.

### 1.3 Pin-projection structural-pinning bugs?

None possible: no code exists that projects from `Pin<&mut Outer>` to
`Pin<&mut Field>`. The single Pin site doesn't project — it just hands
back the `Pin<Box<Self>>` so the caller is forced to use
`Pin::into_inner_unchecked` if they want a raw pointer. (And nobody
does, because `init` is unused.)

### 1.4 `pin-project` / `pin-project-lite` usage

```sh
rg '#\[pin_project\]|pin_project_lite|pin_project::pin_project' src/ --type rust
```

**Result: 0 occurrences.** Bun does not use the `pin-project` /
`pin-project-lite` crates. There is no opportunity for "projecting to a
non-structurally-pinned field" misuse because there is no projection.

### 1.5 Section 1 verdict — NO BUGS

**Pin-related UB surface in Bun's Rust tree is effectively empty.** The
async ecosystem that drives Pin's importance (Futures requiring stable
self-references across `.await` points) is not present: Bun has its own
manual event-loop dispatch via raw `*mut Task` and intrusive linked
lists. The intrusive-list pinning invariant ("don't move the
heap-allocated node") is enforced informally by the
`heap::into_raw`/raw-ptr-only idiom, not by `core::pin::Pin`.

**No PR recommended.** If/when Bun adopts the standard Future trait
(Phase B notes in the source already plan this for several types), the
Pin discipline will need to be redone — but as of today, there is
nothing to audit.

---

## Section 2 — Panic-in-Drop Hazards

### 2.1 Build-profile prior

`Cargo.toml` (verified):

```toml
[profile.release]
panic = "abort"

[profile.dev]
panic = "abort"

[profile.shim]
inherits = "release"
panic = "abort"
```

All three runtime profiles abort on panic. Combined with no `extern
"C-unwind"`, no Rust panic in Bun's built runtime produces a stack unwind. **This
eliminates all four UB hazards traditionally associated with
panic-in-Drop:**

- Double-panic abort: cannot happen, there is no first unwind.
- Panic crossing FFI: cannot happen, panic is abort.
- `MutexGuard` poisoning on panic-while-locked: cannot happen, no
  unwind to release a guard.
- Drop running halfway then aborting on the inner panic: cannot happen,
  abort is taken before any cleanup begins.

What *can* happen is **process-wide abort** if a Drop body panics.
That's an availability hazard, severity C. The audit below classifies
each hit on that basis.

### 2.2 Survey

Six production Drop bodies contain a panic-prone call after stripping
`debug_assert*!` macros and `cfg(debug_assertions)` blocks:

| File:line                                                    | Call                                                  | Verdict       |
| ------------------------------------------------------------ | ----------------------------------------------------- | ------------- |
| `src/bun.rs:858`                                             | `bun_sys::fchdir(self.prev_fd).expect("unreachable")` | **HAZARD-C1** |
| `src/collections/bit_set.rs:1379`                            | `Layout::array::<usize>(self.buf_len).expect(…)`      | UNREACHABLE   |
| `src/collections/hive_array.rs:429`                          | `index_of(…).expect("HiveSlot points outside …")`     | UNREACHABLE   |
| `src/http/HTTPContext.rs:1055`                               | `u16::try_from(idx).expect("int cast")`               | UNREACHABLE   |
| `src/ptr/CowSlice.rs:339`                                    | `self.debug.unwrap()`                                 | DEBUG-ONLY    |
| `src/sql_jsc/mysql/MySQLRequestQueue.rs:347`                 | `NonNull::new(request).expect("queue item non-null")` | **HAZARD-C2** |

### 2.3 Site walkthroughs

#### 2.3.1 `src/bun.rs:860` — `fchdir().expect("unreachable")`  → **HAZARD-C1**

```rust
impl Drop for CwdRestore {
    fn drop(&mut self) {
        if self.restore {
            bun_sys::fchdir(self.prev_fd).expect("unreachable");
        }
        bun_sys::close(self.prev_fd);
    }
}
```

Used in `get_fd_path_via_cwd` (line 851), the Linux-only `readlink
/proc/self/fd/N` fallback. `prev_fd` is obtained via `openat(".",
O_DIRECTORY)`, then `fchdir(target_fd)` runs, then `getcwd` reads the
path of `target_fd`, then on Drop `fchdir(prev_fd)` restores cwd.

**Why this can fail in practice.**
`fchdir(fd)` on a directory fd held open by this process will not fail
with EBADF or ENOTDIR — those are foreclosed by the `openat` flag and
the type. But it *can* fail with **EACCES** if the directory's execute
permission is revoked by `fchmod` between the `openat` and the
restoration. It can also fail with **EIO** if the underlying device
errored. These are rare but real for a daemon that runs as a less
privileged user, or against a network filesystem.

**Severity.** A panic here aborts Bun. Triggering requires either a
malicious adversary with permission to chmod a directory Bun has open,
or an I/O error. The function is called from `get_fd_path`, which is
itself used by `Bun.file().path` and friends. A user-controllable JS
path can drive this code; the directory permissions cannot easily be
attacker-controlled, so the practical exposure is "Bun aborts when the
filesystem misbehaves."

**Fix sketch.** Drop the `expect`; log the errno via
`bun_core::pretty_errorln!` (or via the panic-hook-safe stderr writer)
and proceed to `close(prev_fd)`. The process is in an unrecoverable
cwd-state anyway (next syscall using a relative path may go to the
wrong directory), so the user-visible outcome is roughly the same; we
just don't add a "service-down" failure on top of a "wrong-cwd"
failure.

**Filing as a beads candidate: pre-existing-ub-N/A**, classified
**C-CL-DROP-AVAIL** (correctness / availability / drop-path).

#### 2.3.2 `src/collections/bit_set.rs:1379` — `Layout::array().expect`  → unreachable

```rust
impl Drop for DynamicBitSetList {
    fn drop(&mut self) {
        if self.buf_len == 0 { return; }
        let layout = core::alloc::Layout::array::<usize>(self.buf_len).expect("unreachable");
        unsafe { std::alloc::dealloc(self.buf.as_ptr().cast(), layout) };
    }
}
```

`Layout::array::<usize>(n)` returns `Err` iff `n * 8 > isize::MAX` (on
64-bit) or `n * 4 > isize::MAX` (on 32-bit). The `buf` was allocated
with the same `Layout::array::<usize>(buf_len)` call in `init_empty`;
allocation already succeeded, so the same call cannot now fail. **Truly
unreachable.** No fix needed.

#### 2.3.3 `src/collections/hive_array.rs:429` — `index_of().expect`  → unreachable-or-corruption-detector

```rust
let index = (*hive)
    .index_of(self.slot.as_ptr().cast::<T>())
    .expect("HiveSlot points outside its owning hive");
```

`index_of` returns `Some(i)` iff the pointer falls within the hive's
inline slot array. The slot pointer is stamped into `HiveSlot.slot` by
`HiveArray::claim`, which only hands out pointers into its own array.
If `index_of` returns `None`, **the slot has been corrupted** (or the
caller mis-tagged a fallback slot as an inline slot via the
`owner & 1 == 0` low-bit discriminator). Aborting is appropriate.
**No fix needed.**

#### 2.3.4 `src/http/HTTPContext.rs:1055-1066` — `u16::try_from(idx).expect`  → unreachable

```rust
let mut iter = self.pending_sockets.used.iterator::<true, true>();
while let Some(idx) = iter.next() {
    let pooled_ptr = self
        .pending_sockets
        .at(u16::try_from(idx).expect("int cast"));
```

`pending_sockets` is `PooledSocketHiveAllocator<SSL> = HiveArray<…,
POOL_SIZE>`; `POOL_SIZE = 64` (`src/http/HTTPContext.rs:`). `idx` is
a `usize` index into the bitset, bounded above by `POOL_SIZE`. The
truncation to `u16` is provably-safe; **the expect is dead code.**
A `unwrap_unchecked` would be equivalent at runtime; the diagnostic
message is gratuitous. **No fix needed**; could be tightened to
`idx as u16` for clarity, but that's style.

#### 2.3.5 `src/ptr/CowSlice.rs:339` — `self.debug.unwrap()`  → debug-only

```rust
fn drop(&mut self) {
    #[cfg(debug_assertions)]
    if let Some(dbg) = self.debug_data() {
        …
        if self.is_owned() {
            …
            drop(unsafe { bun_core::heap::take(self.debug.unwrap().as_ptr()) });
        }
    }
    …
}
```

The `unwrap` is inside `#[cfg(debug_assertions)]` and immediately after
`if let Some(dbg) = self.debug_data()` which already destructured an
`Option<NonNull<DebugData>>`. The second `unwrap` is on the same
`self.debug` field (the original `Option`), which `debug_data()` just
proved is `Some`. **Provably-safe** under the same `if let Some`
shadow. Release builds strip the whole `if`. **No fix needed**, though
the redundant `.unwrap()` could be replaced with destructuring
(`if let Some(dbg) = self.debug { … }` and reuse `dbg.as_ptr()`).

#### 2.3.6 `src/sql_jsc/mysql/MySQLRequestQueue.rs:347` — `NonNull::new(request).expect`  → **HAZARD-C2**

```rust
impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        while let Some(request) = self.requests.with_mut(|q| q.read_item()) {
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            req.mark_as_failed();
            unsafe { JSMySQLQuery::deref(request) };
        }
        …
    }
}
```

`self.requests.with_mut(|q| q.read_item())` returns `Option<*mut
JSMySQLQuery>`. If the inner `Option` is `Some(null_ptr)`, the outer
`Some(null)` flows through, `NonNull::new(null)` returns `None`, the
`expect` panics, and the queue drop aborts the process — without
emptying the rest of the queue.

**Is a null in the queue reachable?** The push side (line 339-343, just
above) uses `JSMySQLQuery::ref_(request_ptr)` then `q.write_item(request_ptr)`;
`request_ptr` is a `*mut JSMySQLQuery` from a `ParentRef`/`heap::alloc`
path. None of those produce null. So in practice the `expect` is
unreachable.

**But:** the queue is FFI-adjacent — `with_mut` reaches a
`std::collections::VecDeque`-style intrusive ring whose elements come
from `*mut`-shaped callsites. The audit cannot prove that no future
caller will push a null. The defense-in-depth fix is cheap:

```rust
let Some(req_nn) = NonNull::new(request) else { continue };
let req = ParentRef::from(req_nn);
…
```

Or, more aggressively, panic only in debug:

```rust
let req_nn = NonNull::new(request);
debug_assert!(req_nn.is_some(), "queue item non-null");
let Some(req_nn) = req_nn else { continue };
```

**Severity C** (availability hardening, not UB). Filing as
**C-CL-DROP-AVAIL**.

### 2.4 Drop bodies that lock — 3 sites

Files that take a `Mutex`-style lock in their Drop:

| File:line                                            | Lock                      | Verdict |
| ---------------------------------------------------- | ------------------------- | ------- |
| `src/jsc/SavedSourceMap.rs:259`                      | `self.lock()`             | OK      |
| `src/ptr/CowSlice.rs:339`                            | `dbg.mutex.lock()` (dbg)  | OK      |
| `src/runtime/bake/DevServer.rs:1106`                 | `graph_safety_lock.lock()`| OK      |

All three lock a `bun_threading::Mutex` / `bun_core::util::Mutex` /
`ThreadLock` (`src/runtime/bake/DevServer.rs`'s `graph_safety_lock`
field). Bun's wrappers are non-poisoning. Combined with `panic =
"abort"`, there is no scenario where the lock is poisoned at the point
of Drop. **No bug.**

The classical "Drop locks a mutex held by the panicking thread → deadlock"
problem cannot occur either: under `panic = "abort"`, the panicking
thread is dying with no stack unwind, so its lock-holding is irrelevant —
the OS releases its resources at abort.

### 2.5 Drop bodies that allocate — 0 sites

The scanner found zero Drop bodies that call `Box::new`, `vec!`,
`Vec::with_capacity`, `String::with_capacity`, `.to_string()`, or
`format!`. Excellent.

### 2.6 Drop bodies that call FFI — 14 sites

| File:line                                              | Call                                                       | Concern                |
| ------------------------------------------------------ | ---------------------------------------------------------- | ---------------------- |
| `src/bun.rs:858`                                       | `bun_sys::fchdir/close`                                    | Section 2.3.1          |
| `src/bun_alloc/MimallocArena.rs:576`                   | `mimalloc::mi_heap_destroy`                                | OK (cannot fail)       |
| `src/http/HTTPContext.rs:1055`                         | `bun_boringssl_sys::SSL_CTX_free`                          | OK (void, cannot fail) |
| `src/http_jsc/websocket_client/WebSocketDeflate.rs:89` | `libdeflate_sys::*_free_*`                                 | OK                     |
| `src/jsc/rare_data.rs:1179`                            | `boring::ENGINE_free` + `boring::SSL_CTX_free`             | OK                     |
| `src/runtime/cli/test/parallel/Channel.rs:511`         | `Pipe::close_and_destroy`                                  | OK                     |
| `src/runtime/ffi/mod.rs:379`                           | `TCC::tcc_delete` + `FFICallbackFunctionWrapper_destroy`   | OK                     |
| `src/runtime/server/FileResponseStream.rs:560`         | `bun_sys::*`                                               | OK                     |
| `src/runtime/socket/WindowsNamedPipe.rs:1390`          | `Pipe::close_and_destroy`                                  | OK                     |
| `src/spawn/process.rs:1530`                            | `Pipe::close_and_destroy`                                  | OK                     |
| `src/spawn_sys/posix_spawn.rs:378`                     | `system::posix_spawnattr_destroy`                          | OK (void)              |
| `src/spawn_sys/posix_spawn.rs:487`                     | `system::posix_spawn_file_actions_destroy`                 | OK (void)              |
| `src/spawn_sys/spawn_process.rs:655`                   | `bun_sys::set_close`                                       | OK                     |
| `src/sys/windows/mod.rs:4323`                          | `bun_sys::*`                                               | OK                     |

Every FFI call in Drop is to a `*_destroy` / `*_free` / `*_close` style
sink. None of these return a value that the Drop body acts on (in
particular, none of them have an `.expect()` on the result). The libuv
`Pipe::close_and_destroy` may invoke a C callback later — but
asynchronously, not synchronously inside this Drop body. **No bug.**

The only place an FFI return is acted upon is `bun.rs:860`
(Section 2.3.1) — the `fchdir` return is `.expect`ed. That is the one
hazard.

### 2.7 Section 2 verdict — 2 availability hazards, no UB

**Two C-class hazards** to file:

1. `src/bun.rs:858` — `fchdir().expect("unreachable")` in
   `CwdRestore::drop`. Replace with log + best-effort.
2. `src/sql_jsc/mysql/MySQLRequestQueue.rs:347` —
   `NonNull::new(request).expect("queue item non-null")` in
   `MySQLRequestQueue::drop`. Replace with `let Some(req_nn) = … else
   { continue };` plus a `debug_assert!`.

The other four hits (`bit_set`, `hive_array`, `HTTPContext`,
`CowSlice`) are correctness assertions of static invariants and need
no change. The lock-in-Drop and FFI-in-Drop sweeps surface nothing.

---

## Section 3 — Async / Task-Cancellation Safety

Bun has no async/await for runtime logic — it uses a manual event loop
(`src/event_loop/AnyEventLoop.rs`, `src/jsc/event_loop.rs`,
`MiniEventLoop.rs`) and intrusive task queues (`UnboundedQueue`,
`ConcurrentTask`, `AnyTask`). The audit translates "cancellation
safety" into: when a task is enqueued and the consumer or producer
side is torn down, does the task's invariant set survive Drop?

### 3.1 `JSBundleCompletionTask` — JS thread ⇄ bundle thread

`src/runtime/api/js_bundle_completion_task.rs:59-83` — struct holds
`JSPromiseStrong promise`, `BackRef<EventLoop> jsc_event_loop`,
`KeepAlive poll_ref`, `bun_threading::Link next` (intrusive queue link),
plus FFI handles.

Lifecycle:

1. **Create on JS thread** (line 118-145). At this point `promise =
   JSPromiseStrong::default()` (empty handle, no JS allocation).
2. **Enqueue to bundle thread** (line 151,
   `bun_bundler::bundle_v2::singleton::enqueue::<…>(completion)`).
   The bundle thread reads / mutates only `transpiler`, `result`,
   `log`, `cancelled` — never `promise`.
3. **Initialize promise on JS thread** (line 174,
   `(*completion).promise = jsc::JSPromiseStrong::init(global_this);`).
   This happens *after* enqueue but on the JS thread.
4. **Bundle thread finishes**, calls `complete_on_bundle_thread`
   (line 998), which enqueues a `ConcurrentTask` back to the JS
   event loop (line 1002).
5. **JS thread runs `on_complete_anytask`** (line 556), which does
   `_drop_ref = ScopedRef::adopt(ctx)` (line 561) — this is the
   refcount-1 hand-off. When `_drop_ref` drops at end of scope,
   `JSBundleCompletionTask::deinit` runs (line 90), dropping
   `JSPromiseStrong` on the JS thread.

**Cancellation paths.** `this.cancelled` (line 71) is set at line 566 in
`on_complete_anytask` — but the early-return on cancelled just bypasses
the resolve, it still falls through to the `_drop_ref` Drop at end of
scope, so `deinit` still runs on the JS thread. **OK.**

**Worst case.** If the bundle thread crashes/aborts before posting
back, `JSBundleCompletionTask` allocation leaks; `JSPromiseStrong`'s
slot is set on the JS thread (step 3) but never released. The promise
slot leaks but does NOT get dropped on the wrong thread. **OK.**

**Verdict: SOUND.** The `unsafe impl Send for JSBundleCompletionTask`
at line 106 is justified by:
- Bundle thread accesses only `Send`-safe fields.
- JS-thread-only fields (`promise`, `global_this`) are read/written only
  in JS-thread callbacks.
- Drop of those fields runs only on the JS thread via the
  `ScopedRef::adopt` hand-off.

### 3.2 `ConcurrentPromiseTask` — JS thread ⇄ work pool

`src/jsc/ConcurrentPromiseTask.rs:31-47`. Struct holds:
- `ctx: Box<Context>` — the worker payload.
- `task: WorkPoolTask` — the intrusive node.
- `event_loop: BackRef<EventLoop>` — Send-safe pointer (back-reference).
- `promise: JSPromiseStrong` — JS-thread-bound.
- `global_this: &'a JSGlobalObject` — JS-thread-bound.
- `concurrent_task: ConcurrentTask` — intrusive cross-thread task.
- `ref_: KeepAlive` — atomic counter.

Lifecycle:

1. **`create_on_js_thread`** (line 64). Allocates the box, inits
   `promise` on the JS thread, takes a `ref_` on the VM.
2. **`schedule`** (line 104). `WorkPool::schedule(&raw mut self.task)`
   sends the raw pointer to a worker.
3. **Worker calls `run_from_thread_pool`** (line 84). Recovers
   `*mut Self`, calls `(*this).ctx.run()`.
4. **Worker calls `on_finish`** (line 108). Wraps the same pointer in a
   `ConcurrentTask` and `enqueue_task_concurrent`s it to the JS
   event loop. No drop on the worker side.
5. **JS thread runs `run_from_js`** (line 97). Calls
   `self.promise.swap()` (on the JS thread, OK), then `ctx.then(promise)`.
6. **JS thread destroys via `Self::destroy`** (line 130).
   `heap::take(this)` drops `JSPromiseStrong` on the JS thread.

The `unsafe impl<C> Send for ConcurrentPromiseTask<'_, C>` (line 55)
is justified by the same argument as 3.1: worker thread reads only
`ctx` and the intrusive `task` node; the JS-thread-bound fields are
only ever touched in JS-thread code paths; the Drop runs on the JS
thread via the `destroy` hand-off.

**Cancellation hole?** What if the VM is shutting down while a
`ConcurrentPromiseTask` is mid-flight? Two cases:

- Worker has not yet posted back: the worker eventually calls
  `enqueue_task_concurrent`, but the JS event loop is gone. The
  `ConcurrentTask` becomes orphaned. The allocation leaks but is not
  dropped on the wrong thread, because no thread drops it.
- Posted back, but JS thread doesn't pick it up: the task sits in the
  queue forever, eventually freed when the event-loop allocation is
  freed. The allocation leaks.

Neither case touches the JS-thread-only fields from the wrong thread.
**Verdict: SOUND** (with a documented leak on VM shutdown).

### 3.3 `FetchTasklet` — HTTP thread ⇄ JS thread

`src/runtime/webcore/fetch/FetchTasklet.rs:57-130` — large struct
holding `Strong`/`Weak`/`JSPromiseStrong`/`ReadableStreamStrong`/
`StrongOptional` fields, plus HTTP thread state. Refcount discipline
is **thread-safe** via `bun_ptr::ThreadSafeRefCount`. The critical
piece is `deref_from_thread` (line 374-391):

```rust
pub fn deref_from_thread(this: *mut FetchTasklet) {
    if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {
        return;
    }
    let self_ = Self::from_raw_ref(this);
    if self_.javascript_vm.is_shutting_down() {
        unsafe { FetchTasklet::deinit(this) };
        return;
    }
    // route Drop back to JS thread
    Self::enqueue_concurrent(
        self_.javascript_vm,
        ConcurrentTask::from_callback(this, FetchTasklet::deinit_callback),
    );
}
```

This is the **canonical correct pattern** for Send-violation-through-Drop:
the last `deref` checks the calling thread; if not the JS thread, it
routes the Drop back via a concurrent task whose `deinit_callback`
(line 395) runs `FetchTasklet::deinit(this)` on the JS thread, where
the Strong handles can be safely released. **Best-in-class pattern.**
The comment in `src/CLAUDE.md` about "the canonical example of this bug
class and its fix" refers to exactly this code.

**Verdict: SOUND.** Other cross-thread refcounted types that hold
`Strong` values should follow this pattern.

### 3.4 Subprocess / Process

`src/spawn/process.rs:141-148` — `Process::drop` only calls
`self.poller.deinit()`. The struct does not hold any `Strong` /
`Weak` JS handles directly; the JS-facing wrapper is `Subprocess` in
`src/runtime/api/bun/subprocess.rs`. `Subprocess::finalize` (line 1226)
is the JS-thread-only entry point that releases the abort signal, JS
wrappers, and process refcount. The abort signal release path
(`clear_abort_signal`, line 1215) is JS-thread-only (BackRef + intrusive
refcount). **Sound.**

### 3.5 Watcher::thread_main and similar cross-thread spawns

`src/watcher/Watcher.rs:thread_main` — the watcher thread holds a
`*mut Watcher` raw pointer (Send-safe by cast), not a `Strong`. Drop on the
watcher thread doesn't touch JS state, so it is not a **JSC-handle Drop**
violation. This does **not** prove the watcher ownership protocol sound:
`A-002-heap-roundtrip-audit.md` separately tracks `L-001`, where
`Watcher::thread_main` can free the `Watcher` while a concurrent `shutdown`
still reads `watchloop_handle`. Classify that as a high-confidence ownership
race, not as a Pin/Strong-drop finding.

`src/jsc/Debugger.rs:583-600` — debugger thread holds a `SendVmPtr(*mut
VirtualMachine)`. The `VirtualMachine` itself contains `Strong`-holding
fields but the debugger thread only reads `vm` under the JSC API lock
(`holdAPILock`), never drops the VM. **Sound.**

`src/runtime/node/fs_events.rs` — FSEvents thread holds raw pointers
captured by a closure, not `Strong` handles. **Sound.**

### 3.6 Section 3 verdict — NO BUGS

All cross-thread task paths I traced have **explicit thread-routing for
Drop of JS-thread-bound state**, or hold only Send-safe state on the
worker side. The `FetchTasklet::deref_from_thread` pattern is the
template the audit should generalize from in any future port: anywhere
a struct contains a `Strong`-like field and crosses threads via
refcount transfer, the last-deref path must check thread identity.

---

## Section 4 — Send-Violation-Through-Drop

The hazard class: a `T: !Send` whose Drop runs on a thread other than
the construction thread is unsound iff Drop touches thread-affine
state. For `bun_jsc::Strong` / `Weak` (per `src/CLAUDE.md` "Cross-thread
string hazards" and I-002), the JS handle table is per-thread.

### 4.1 The 64 `unsafe impl Send`

```sh
rg 'unsafe impl Send' src/ --type rust | wc -l
# 64
```

For each, I checked the struct's fields for `Strong` / `Weak` /
`JSPromiseStrong` / `StrongOptional` / `JscStrong` / `BackRef<JSGlobalObject>` /
`*mut JSGlobalObject` / `JSValue`:

- 47 structs hold no JS-thread-bound state. The `Send` is for raw
  pointers to allocator/queue state where the Send-safety is documented
  in the SAFETY comment (ThreadPool, BundleThread, MimallocArena,
  string pools, CryptoCtx, etc.). **No concern.**
- 12 structs hold `BackRef<…>` only. `BackRef` is a `Copy`/Send-safe
  thin pointer wrapper that does *not* run any release-on-Drop — the
  pointee is owned elsewhere. **No concern.**
- 5 structs hold `Strong`-like state but route Drop back to the JS
  thread (Section 3): `JSBundleCompletionTask`, `ConcurrentPromiseTask`,
  `FetchTasklet`, plus two via the FetchTasklet pattern
  (`ShellRmTask`, `IOWriter`). **No concern; Section 3 covers.**

### 4.2 `unsafe impl Send for Strong` — does it exist?

No. `Strong` (`src/jsc/Strong.rs:11-15`) contains
`NonNull<Impl>` which is auto-`!Send + !Sync`. There is **no**
`unsafe impl Send for Strong`. Likewise `Optional`. Likewise
`bun_jsc::Weak`. Likewise `JSPromiseStrong` (transitively, since its
inner is `JscStrong` = `strong::Optional`).

The only way `Strong` ever crosses a thread is *inside a wrapper that
holds it and was itself `unsafe impl Send`'d*. Section 4.1 enumerated
those wrappers; all are sound (Section 3).

### 4.3 `bun_jsc::Strong` field rg

```sh
rg -l 'JSPromiseStrong|: Strong[,)]\|StrongOptional|: Weak<' src/ --type rust
```

Returns a manageable file set (32 files). Cross-referenced with
"file has `unsafe impl Send`": only the five sites in 4.1 overlap. Every
other usage is JS-thread-bound by construction — the struct holds
JS-thread-only state and is itself `!Send` (transitively).

### 4.4 Section 4 verdict — NO BUGS

Bun's `Send` discipline around JS handles is correct. `Strong` /
`Weak` are unconditionally `!Send`; the runtime never explicitly opts
them in. The only ways such a value crosses threads are inside a
wrapping refcounted type whose deref-path checks thread identity
(`FetchTasklet` pattern). Five wrappers exist, all sound.

---

## Cross-Cutting Observations

### O-1. Bun's pinning model is "leaked Box + raw pointer," not `core::pin::Pin`.

Every intrusive structure (`UnboundedQueue`, `ConcurrentTask`, the
`event_loop` task queues, `HiveArray`'s heap fallback) relies on
"heap-allocate via `heap::alloc` / `heap::into_raw`; never move; free
via `heap::destroy` / `heap::take`." The discipline is enforced by
**convention** (the `unsafe { (*p).field = … }` pattern around
self-referential init in `ConsoleObject`), by **type-level capture**
(closing over `*mut T` only, not `&mut T` — see
`bun_io::impl_buffered_reader_parent!` in
`src/io/PipeWriter.rs` and the comments at
`src/CLAUDE.md` "Pointer provenance at FFI boundaries"), and by
**Drop sites that match the alloc sites** (`bun_core::heap::destroy`).

This convention has held up well across the port: the audit found no
Pin-projection UB because there are no Pin projections to mismess.

### O-2. Panic-in-Drop UB cannot occur. Panic-in-Drop availability hazard can.

`panic = "abort"` in Bun's runtime profiles + no `extern "C-unwind"` eliminates
the runtime UB axis of panic-in-Drop. The two hazards I'm filing (`bun.rs:860`,
`MySQLRequestQueue.rs:347`) are *availability* concerns: a single
panic in those Drop bodies aborts the process. Severity C.

### O-3. The `FetchTasklet::deref_from_thread` pattern is canonical.

Other refcounted JS-handle-holding types should adopt it. As of this
audit, every cross-thread refcounted type that holds JS handles
already does so or has documented justification (Section 3). Future
ports of additional Zig code should be reviewed against this template.

### O-4. No bug-fixing PRs needed for UB.

The combination of `panic = "abort"`, absence of Pin projection,
universal `!Send` for `Strong`, and disciplined `heap::*` pairing
covers every hazard class this pass examined. The two C-class
availability tickets in Section 2 are hardening, not bug fixes.

---

## Recommended PR(s)

### PR-1 — `CODEX-P2-drop-availability` — C-class hardening

Two surgical changes:

1. `src/bun.rs:860`. Replace:
   ```rust
   bun_sys::fchdir(self.prev_fd).expect("unreachable");
   ```
   with:
   ```rust
   if let Err(err) = bun_sys::fchdir(self.prev_fd) {
       // EACCES if cwd perms changed under us, EIO from disk faults.
       // Cwd is now in an unexpected state; log and proceed — aborting
       // here would compound a recoverable error into a service outage.
       bun_output::scoped_log!(getfdpath, "fchdir restore failed: {err}");
   }
   ```

2. `src/sql_jsc/mysql/MySQLRequestQueue.rs:347-359`. Replace:
   ```rust
   let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
   req.mark_as_failed();
   unsafe { JSMySQLQuery::deref(request) };
   ```
   with:
   ```rust
   let Some(req_nn) = NonNull::new(request) else {
       debug_assert!(false, "MySQLRequestQueue holds null pointer");
       continue;
   };
   let req = ParentRef::from(req_nn);
   req.mark_as_failed();
   unsafe { JSMySQLQuery::deref(request) };
   ```

**Test plan.**

- For (1): synthesize a temp directory, `Bun.file(fd).path` against it,
  delete the directory between the `openat` and the implicit Drop.
  Hard to reproduce reliably; rely on code review.
- For (2): build the debug binary, run the existing MySQL test suite
  (`bun bd test test/js/sql/mysql/`) — no behavior change in normal
  paths; only the failure path differs.

### No other PRs recommended.

Pin projection (Section 1), async cancellation (Section 3), and
Send-violation-through-Drop (Section 4) have no actionable bugs in
the current tree.

---

## Beads ledger candidates

Section 2 produces two beads candidates, both severity C:

- **`pre-existing-c-drop-fchdir`** — `src/bun.rs:858-863`. CwdRestore
  Drop panics on `fchdir` failure. Replace with log + best-effort.
- **`pre-existing-c-drop-mysql-queue-null`** — `src/sql_jsc/mysql/
  MySQLRequestQueue.rs:347-360`. `NonNull::new(request).expect` panics
  if a null ever enters the queue. Defense-in-depth: `let Some(_) =
  NonNull::new(_) else continue;` + `debug_assert!`.

Sections 1, 3, and 4 produce **zero** beads candidates: the surface is
either empty (Pin) or sound (cross-thread Drop, Send-violation).
