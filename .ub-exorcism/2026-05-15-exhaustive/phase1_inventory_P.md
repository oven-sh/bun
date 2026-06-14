# Phase 1 Inventory — Section P: sys-io-event-loop-threading

Run: `2026-05-15-exhaustive`. Scope: `src/sys/`, `src/sys_jsc/`, `src/io/`, `src/spawn/`, `src/spawn_sys/`, `src/event_loop/`, `src/threading/`, `src/errno/`.

## Mapper tallies (audited base `origin/main@4d443e5402`)

| crate              | files | `unsafe` keyword sites (heuristic) | prior-audit sites |
| ------------------ | ----- | ---------------------------------- | ----------------- |
| `bun_sys`          | 13    | 419                                | 332               |
| `bun_sys_jsc`      | 4     | 3                                  | 2                 |
| `bun_io`           | 14    | 300                                | 213               |
| `bun_spawn`        | 3     | 111                                | 105               |
| `bun_spawn_sys`    | 3     | 37                                 | 33                |
| `bun_event_loop`   | 11    | 81                                 | 65                |
| `bun_threading`    | 14    | 140                                | 126               |
| `bun_errno`        | 5     | 3                                  | 3                 |
| **Section P**      | 67    | **1094**                           | **879** (+215)    |

The `1094` is a `rg 'unsafe (fn|impl|trait|extern|\{)'` line-count headline; the prior-audit `879` is the dedup'd-site count from `unsafe-inventory.jsonl`. Use `1094` only as Phase-1 mapper-local workload; Phase 2 normalization will re-id current-source rows.

SAFETY-comment density across the section: **766 SAFETY comments** vs. ~1163 `unsafe` occurrences (≈66% line-level coverage) — high, but heavily front-loaded in `src/io/PipeWriter.rs` (132 SAFETY/82 unsafe) and `src/sys/lib.rs` (303/140); the `src/io/posix_event_loop.rs` ratio is much weaker (10 SAFETY across 15 unsafe blocks).

## Per-file unsafe distribution (top 25)

| file                                      | unsafe sites |
| ----------------------------------------- | ------------ |
| `src/sys/lib.rs`                          | 303          |
| `src/io/PipeWriter.rs`                    | 132          |
| `src/spawn/process.rs`                    | 105          |
| `src/io/lib.rs`                           | 67           |
| `src/threading/ThreadPool.rs`             | 53           |
| `src/sys/windows/mod.rs`                  | 50           |
| `src/io/PipeReader.rs`                    | 40           |
| `src/sys/sys_uv.rs`                       | 27           |
| `src/sys/linux_syscall.rs`                | 27           |
| `src/event_loop/AnyEventLoop.rs`          | 27           |
| `src/spawn_sys/posix_spawn.rs`            | 24           |
| `src/threading/unbounded_queue.rs`        | 23           |
| `src/event_loop/MiniEventLoop.rs`         | 23           |
| `src/io/posix_event_loop.rs`              | 18           |
| `src/threading/work_pool.rs`              | 17           |
| `src/event_loop/SpawnSyncEventLoop.rs`    | 16           |
| `src/io/source.rs`                        | 15           |
| `src/io/windows_event_loop.rs`            | 14           |
| `src/threading/Mutex.rs`                  | 13           |
| `src/spawn_sys/spawn_process.rs`          | 12           |
| `src/threading/Futex.rs`                  | 11           |
| `src/spawn/static_pipe_writer.rs`         | 7            |
| `src/event_loop/EventLoopTimer.rs`        | 7            |
| `src/io/heap.rs`                          | 9            |
| `src/threading/RwLock.rs`                 | 5            |

## Anchor & EXP-002 status

`linux_errno.rs:181-193` — `impl GetErrno for usize` is **UNCHANGED** since prior audit. Current source:

```rust
impl GetErrno for usize {
    #[inline]
    fn get_errno(self) -> E {
        // `as` between same-width usize/isize is a bit-reinterpretation (Zig: @bitCast)
        let signed = self as isize;
        let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
        // SAFETY: int is in [0, 4096); E is #[repr] over the kernel errno range
        unsafe { core::mem::transmute::<u16, E>(int as u16) }
    }
}
```

The miri-confirmed UB (kernel rc `-EHWPOISON+1 = -134` produces `int = 134`, not a declared `SystemErrno` discriminant on Linux where dense range is `0..=~133`) **still applies**. Sibling checked impls now exist in `src/errno/lib.rs:288-333` (`SystemErrno::init` returns `Option<SystemErrno>`, and `from_raw` debug-asserts on POSIX) and `src/errno/windows_errno.rs:262-265` (`E::try_from_raw` returns `Option<E>` via `strum::FromRepr`). The Linux `impl GetErrno for usize` was **NOT** patched — it still calls a raw `transmute`, not the checked `SystemErrno::init` path. No live caller in-tree (Bun's Linux raw-syscall layer routes through rustix); the `pub` `usize` impl is latent.

## Send / Sync impls inventory (manual cross-thread surface)

| impl | file:line | bound | notes |
|---|---|---|---|
| `Channel<T,B>: Send` | `src/threading/channel.rs:47` | `T: Send, B: LinearFifoBuffer<T>` | All interior-mut state guarded by `mutex`; OK. |
| `Channel<T,B>: Sync` | `src/threading/channel.rs:49` | same | Same justification; OK. |
| `Condition::WindowsImpl: Sync/Send` | `src/threading/Condition.rs:223-224` | (none) | OS primitive; OK. |
| `GuardedBy<Value,M>: Sync` | `src/threading/guarded.rs:38` | `Value: Send, M: RawMutex + Sync` | Conservative; OK. |
| `Mutex::WindowsImpl: Sync/Send` | `src/threading/Mutex.rs:210/212` | (none) | SRWLOCK is OS-internal-sync; OK. |
| `Mutex::DarwinImpl: Sync/Send` | `src/threading/Mutex.rs:263/265` | (none) | os_unfair_lock is OS-internal-sync; OK. |
| `RwLock<T>: Send` | `src/threading/RwLock.rs:157` | `T: Send` | std-equivalent. |
| `RwLock<T>: Sync` | `src/threading/RwLock.rs:158` | `T: Send + Sync` | std-equivalent. |
| `Semaphore: Sync/Send` | `src/threading/Semaphore.rs:22-23` | (none) | OK. |
| `ThreadPool::Task: Send` | `src/threading/ThreadPool.rs:337` | (none) | Opt-out justified by raw-`*mut Node` field; comment explicit. |
| `ThreadPool::Queue: Sync` | `src/threading/ThreadPool.rs:1493` | (none) | `Cell` field guarded by lock-free `IS_CONSUMING` bit; subtle but documented. |
| `ThreadPool::Queue: Send` | `src/threading/ThreadPool.rs:1494` | (none) | OK. |
| `dir_iterator::Name: Send/Sync` (POSIX) | `src/sys/lib.rs:190/192` | `cfg(not(windows))` | Lifetime-erased `&[u8]` into kernel buf; iterator-thread invariant. |
| `DynLib: Send/Sync` | `src/sys/lib.rs:5890-5891` | (none) | dlopen handle; OS-internally-sync; OK. |
| `WindowsLoop::Waker: Send/Sync` | `src/io/windows_event_loop.rs:377-378` | (none) | `BackRef<WindowsLoop>` to process-global singleton; only forwards `wake()`. |
| `spawn::WaiterThreadPosix::Instance: Sync` | `src/spawn/process.rs:1277` | (none) | UnsafeCell-wrapped singleton; sole mutator is the waiter thread. |

Other `unsafe impl`s in scope (non-Send/Sync, lower-risk):
- Trait-protocol stamps: `Linked` (3 impls — `ConcurrentTask.rs:293`, `MiniEventLoop.rs:71`, `io/lib.rs:1282`, `spawn/process.rs:1052`).
- `bun_ptr::LaunderedSelf` (4 impls in `src/io/PipeWriter.rs:348/691/1522/2030`) — encodes the “raw-`*mut Self` pass-through is sound across re-entry” contract.
- `bun_core::ffi::Zeroable` (≈7 in `src/sys/`, `src/spawn_sys/`) — `repr(C)` POD-zeroability assertions for `bytemuck`-style FFI.
- Macro-emitted: `IntrusiveIoRequest`/`IntrusiveUvFs` in `src/io/lib.rs:1215/1254` — emitted by `intrusive_io_request!`/`intrusive_uv_fs!` macros at every offset_of caller.
- Macro-emitted in `src/threading/work_pool.rs:89/94/115/117/125/127` — `IntrusiveWorkTask` and `OwnedTask` (the latter includes `unsafe impl Send`).

### `GuardedLock` `!Send` marker — STATUS: **MISSING**

Open PR #30765 proposes adding a `_not_send: PhantomData<*const ()>` field to `GuardedLock` (the RAII guard for `GuardedBy::lock()`), but that PR is still unmerged. Current source `src/threading/guarded.rs:132-134`:

```rust
pub struct GuardedLock<'a, Value, M: RawMutex> {
    guarded: &'a GuardedBy<Value, M>,
}
```

No `_not_send` field. `&GuardedBy<…, Mutex>: Send` propagates whenever the protected value satisfies the `GuardedBy: Sync` bound, so `GuardedLock<…, Mutex>` auto-derives `Send`. This **re-exposes the T1 finding**: safe Rust can move a live guard to another thread and drop it there, violating `Mutex::unlock`'s documented same-thread contract. The backend consequences differ (Windows `ReleaseSRWLockExclusive` documents undefined behavior on unowned unlock; Darwin's `os_unfair_lock_unlock` aborts on misuse; the futex backend lacks an owner check in release), but the API-level fix is the same: make the guard `!Send`. `MutexGuard` (the bare-`Mutex::lock_guard()` return) DOES carry `_not_send` (`Mutex.rs:119`), and `RwLockReadGuard`/`RwLockWriteGuard` do too (`RwLock.rs:245/270`); only `GuardedLock` is missing it.

### `Request::store_callback_seq_cst` volatile publication — STATUS: **OPEN (EXP-017; primitive race model confirmed)**

Prior audit ID: `pre-existing-ub-ptr-3`. Current source still has the same shape at `src/io/lib.rs:1153-1168`:

```rust
pub fn store_callback_seq_cst(&mut self, cb: for<'a> fn(&'a mut Request) -> Action<'a>) {
    unsafe { core::ptr::write_volatile(&raw mut self.callback, cb) };
    core::sync::atomic::fence(Ordering::SeqCst);
}
```

The doc comment explicitly describes this as cross-thread publication to an I/O thread. In Rust, a volatile write plus a fence is **not** an atomic store; it does not prevent a data race with a plain read of `request.callback` on another thread. The two obvious read/call sites in this file are `src/io/lib.rs:870` and `:1020` (`match (request.callback)(request)`). Phase 5 added a Miri model (`experiments/EXP-017`) proving the primitive: `write_volatile` races with a cross-thread plain read despite the SeqCst fence. Phase 2 still needs the exact source graph: if `store_callback_seq_cst` only runs before the request is shared, demote to hardening; if any path stores after sharing with the queue/IO thread, this is a real data-race UB and should become a dedicated remediation bead (`AtomicPtr`/`AtomicUsize` function-pointer representation, or a lock-protected callback state). Current call sites store even before `if !io_request.scheduled { schedule(...) }`, so the already-scheduled path is the one to prove or falsify.

### `StoreSlice<T>` Send/Sync — out of scope

`StoreSlice<T> Send/Sync unbounded` at `src/ast/nodes.rs:339-340` is in **section R (parsers-and-lang)**, not section P. Noted only because the prior-audit T1 callout namechecked it.

## `impl_streaming_writer_parent!` macro instances

Definition: `src/io/PipeWriter.rs:2623` (and `impl_buffered_writer_parent!` at 2767).

Section-P call-site:

| caller | file:line | mode |
| --- | --- | --- |
| `StaticPipeWriter<P>` | `src/spawn/static_pipe_writer.rs:75-78` | `borrow = mut` (buffered) |

Out-of-section callers (recorded for cross-section context — covered by other sections):

| caller | file:line | mode |
| --- | --- | --- |
| `FileSink` | `src/runtime/webcore/FileSink.rs:257` | `borrow = ptr` (re-entrant, freeing) |
| `Terminal` (webcore re-export) | `src/runtime/webcore.rs:226-228` | `ptr` per comment |
| `IOWriter` (shell) | `src/runtime/shell/IOWriter.rs:1055` | `borrow = shared` |
| `WindowsNamedPipe` | `src/runtime/socket/WindowsNamedPipe.rs:1435` | `borrow = mut` |

The macro stamps three impls per parent (`PosixStreamingWriterParent`, `WindowsWriterParent`, `WindowsStreamingWriterParent`), each emitting an `unsafe fn` per callback (`on_write`, `on_error`, `on_ready`, `on_close`, `event_loop`, `loop_`). One macro instance ⇒ ~12 `unsafe fn` headers + an `unsafe { … }` per body, none of which appear in the per-file mapper count (they expand at use-sites).

## dirent parser cross-platform branches

Single-source dispatch in `src/sys/lib.rs::dir_iterator`:

| platform | `State` struct | `next()` entry | syscall |
| --- | --- | --- | --- |
| Linux / Android | `lib.rs:322-327` | `lib.rs:338` | raw `getdents64(2)` via `linux_syscall::getdents64` (`src/sys/linux_syscall.rs:486-498`) |
| macOS | `lib.rs:391-398` | `lib.rs:411` | `__getdirentries64` (private libsystem extern decl at `lib.rs:413-419`) |
| FreeBSD | `lib.rs:513-518` | `lib.rs:529` | `getdents` (extern decl at `lib.rs:530-532`) |
| Windows | `lib.rs:587-603` | `lib.rs:616` | `NtQueryDirectoryFile` + `FILE_DIRECTORY_INFORMATION` walk |

Each branch hand-parses a record-layout-specific byte stride from the kernel buffer using `AlignedBuf::filled(end_index)` (an `unsafe fn` at `lib.rs:290`) and then `u16/u64::from_ne_bytes` over `&buf[base..]` slices. All four branches share the same SAFETY-rationale shape (“kernel filled `[0..end_index]`”) and the same `Name::borrow()` raw-`NonNull<u8>` lifetime erasure (POSIX) / per-entry `Vec` copy (Windows).

The original T1 dirent finding (per prior audit, “dirent bugs on macOS/Linux/FreeBSD”) is rooted in the `Name` lifetime: the returned `IteratorResult.name` is a borrow into the iterator’s buffer that is invalidated by the next `next()` call — this is a **streaming-iterator contract that Rust cannot encode in lifetimes** because `Name` carries no `'a` parameter. `unsafe impl Send/Sync for Name` (POSIX) at `lib.rs:190/192` makes the contract worse on paper than it is in practice (callers do not move `Name` across threads), but the hazard is unchanged from the audit window.

## Notable patterns

1. **Raw-`*mut Self` callback discipline (`borrow = ptr`)** — the `LaunderedSelf` + `impl_streaming_writer_parent!` machinery is the section’s most subtle invariant. Where a callback may free `self` (close / error / GC), forming `&mut *this` derives `SharedReadOnly` provenance and `Box::from_raw`-through-it is UB. The macro is the **mitigation**; correctness depends on every parent picking the right `borrow=` mode.
2. **`unsafe extern "C"` (51 sites) + `extern "C" {…}` blocks** — concentrated in `src/sys/lib.rs`, `src/sys/windows/mod.rs`, `src/sys/sys_uv.rs`, `src/sys/linux_syscall.rs`, and the per-platform dirent backings. These are the system-call FFI surface (UB-bucket: FFI/contract).
3. **Lock-free intrusive queues (`UnboundedQueue<T>` via `Linked` trait)** — `Request`, `ConcurrentTask`, `AnyTaskWithExtraContext`, `TaskQueueEntry<T>` all implement `unsafe impl Linked` with the same `core::ptr::addr_of!((*item).next)` body. UB risk: address-of-uninit / use-after-free on the `next` link. Each callsite repeats the same SAFETY rationale; the trait contract documents alignment and validity but not lifetime.
4. **EXP-002 latent transmute** — the `linux_errno::impl GetErrno for usize` path is unreachable from current source but `pub` and one obvious Zig-port pattern away from being introduced. The fix (`SystemErrno::init`) already exists adjacent to it.
5. **Volatile-as-atomic publication** — `Request::store_callback_seq_cst` is the current concrete instance. Fences order atomic operations; they do not make a plain function-pointer field atomic. EXP-017's Miri model confirms the primitive race shape, but the later source-overlap audit found no current overlapping read/write path; keep it as a regression guard and comment-fix target, not as an open production-UB proof obligation.
6. **`UnsafeCell` + non-atomic `Cell` under hand-rolled lock-free orderings** — `ThreadPool::Queue::cache: Cell<*mut Node>` (`ThreadPool.rs:1486`) is the exemplar; correctness relies on the `IS_CONSUMING` bit being CAS-acquired with `Acquire` on take and `Release` on give-back. Tree-Borrows / loom angle untested in this section.

## Open questions

1. Should `GuardedLock` re-acquire the `_not_send` PhantomData marker (or document why dropping it on a different thread is sound despite `Mutex::unlock`'s documented same-thread contract)?
2. The Linux `impl GetErrno for usize` raw transmute — leave as latent and document, or pre-emptively route through `SystemErrno::init` even with no live caller?
3. Does any live path call `Request::store_callback_seq_cst` after sharing a `Request` with the IO queue/thread? If yes, EXP-017 is a data race; if no, rewrite the comment because it currently asserts a cross-thread publication role the implementation cannot soundly provide.
4. `AlignedBuf::filled(end_index)` (`src/sys/lib.rs:290`) takes `&self` and returns `&[u8]` over `MaybeUninit<[u8;BUF_SIZE]>`. The SAFETY comment requires the caller to assert init; the Linux/macOS/FreeBSD branches all pass the same `self.end_index` argument right after a syscall write. Could the helper be made `unsafe fn filled_after_syscall(&self, rc: usize)` with a stricter contract, or carry a debug-mode poison-check?
5. The four `LaunderedSelf` impls in `PipeWriter.rs` (lines 348, 691, 1522, 2030) — is the `bun_ptr::LaunderedSelf` trait contract written down anywhere agents can read, or only in the macro-module comment at `PipeWriter.rs:2580-2604`?

## Anchor cross-refs (EXP-002)

- Witness file: `/data/projects/bun/.unsafe-audit/verification/miri-confirmed-linux-errno-transmute.md`
- Reproduction harness: `/tmp/miri-repro2/src/main.rs` (per witness doc)
- Current source location: `src/errno/linux_errno.rs:192`
- Adjacent checked path that should replace it: `SystemErrno::init` at `src/errno/lib.rs:322`
- Prior-audit ID: `S-001781`
