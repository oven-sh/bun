# Section P: sys-io-event-loop-threading

## Purpose (8 crates)

Bun's lowest-level Rust runtime layer — system calls, file/process I/O, the
event-loop hub, threading primitives, and OS errno mapping. Everything above
section P (`bun_runtime`, `bun_install`, `bun_bundler`, etc.) calls into here for
syscalls (`bun_sys`), pipe/poll/file polls (`bun_io`), child processes
(`bun_spawn`/`bun_spawn_sys`), the `MiniEventLoop`/`AnyEventLoop` dispatch
(`bun_event_loop`), `Mutex`/`Condition`/`ThreadPool`/`UnboundedQueue`
(`bun_threading`), and the cross-platform `SystemErrno` enum (`bun_errno`). This
is the **event-loop hub** and the dominant cross-thread surface in the project.

## Per-crate unsafe-surface tally (vs prior subtotals)

| crate            | site_count (current keyword) | prior_count | dominant_kind          | dominant_bucket(s) |
| ---------------- | ---------------------------- | ----------- | ---------------------- | ------------------ |
| `bun_sys`        | 419                          | 332         | `unsafe_block`         | FFI / syscall, Send/Sync |
| `bun_sys_jsc`    | 3                            | 2           | `unsafe_block`         | JSC ABI |
| `bun_io`         | 300                          | 213         | `unsafe_block`/`fn`    | aliasing-callback (LaunderedSelf), libuv FFI |
| `bun_spawn`      | 111                          | 105         | `unsafe_block`         | posix_spawn FFI, intrusive queue |
| `bun_spawn_sys`  | 37                           | 33          | `unsafe_block`         | posix_spawn FFI, repr(C) |
| `bun_event_loop` | 81                           | 65          | `unsafe_block`         | raw `*mut Self` reborrows, fn-ptr cast |
| `bun_threading`  | 140                          | 126         | `unsafe_block`/`impl`  | Send/Sync, atomic discipline |
| `bun_errno`      | 3                            | 3           | `unsafe_block`         | **validity (errno transmute)** |
| **Section P**    | **1094**                     | **879**     | —                      | — |

Delta `+215`. Drivers: PipeWriter macro framework (`impl_streaming_writer_parent!`/`impl_buffered_writer_parent!`) emitting per-callback `unsafe fn` headers, `intrusive_io_request!`/`intrusive_uv_fs!` macros stamping per-type `unsafe impl`s, and the dirent iterator’s per-platform `State::next` branches each carrying their own `AlignedBuf::filled(...)` reborrow.

## EXP-002 anchor status

- **Source**: `src/errno/linux_errno.rs:181-193`.
- **Verdict**: **STILL APPLIES** (shape unchanged; not patched).
- Current text:
  ```rust
  impl GetErrno for usize {
      #[inline]
      fn get_errno(self) -> E {
          let signed = self as isize;
          let int = if signed > -4096 && signed < 0 { -signed } else { 0 };
          // SAFETY: int is in [0, 4096); E is #[repr] over the kernel errno range
          unsafe { core::mem::transmute::<u16, E>(int as u16) }
      }
  }
  ```
- Sibling checked impls already in tree:
  - `src/errno/lib.rs:294-311` — `SystemErrno::from_raw(n: u16)` (debug-asserts on POSIX; still does the unchecked transmute internally).
  - `src/errno/lib.rs:322-333` — `SystemErrno::init(code: i64) -> Option<SystemErrno>` (POSIX-only; range-checks `code` against `Self::MAX`).
  - `src/errno/windows_errno.rs:244-265` — `E::from_raw` (debug-asserts via `from_repr`) and `E::try_from_raw` returning `Option<E>` (sparse Windows enum; uses `strum::FromRepr`).
- The Linux `usize` impl was **NOT** patched. Checked sibling APIs already exist (`SystemErrno::init`, Windows `E::try_from_raw`), and open PR #30765 proposes using the checked path for Linux, but the current `impl GetErrno for usize` still calls a raw `transmute`. Witness file (`/data/projects/bun/.unsafe-audit/verification/miri-confirmed-linux-errno-transmute.md`) reproduction is verbatim against this current source.

## Send/Sync impls inventory

| impl | file:line | fields | sync mechanism / verdict |
| --- | --- | --- | --- |
| `Channel<T,B>` Send/Sync | `src/threading/channel.rs:47/49` | `mutex`, `UnsafeCell<LinearFifo>`, `Cell<bool>` | All interior-mut state guarded by `mutex`; bound `T: Send`. |
| `Condition::WindowsImpl` Send/Sync | `src/threading/Condition.rs:223/224` | `UnsafeCell<CONDITION_VARIABLE>` | OS primitive; documented thread-portable. |
| `GuardedBy<Value,M>` Sync | `src/threading/guarded.rs:38` | `UnsafeCell<Value>`, `M` | `M: RawMutex + Sync`, `Value: Send`. Conservative; OK. |
| `Mutex::WindowsImpl` Send/Sync | `src/threading/Mutex.rs:210/212` | `UnsafeCell<SRWLOCK>` | SRWLOCK is OS-internally-sync. |
| `Mutex::DarwinImpl` Send/Sync | `src/threading/Mutex.rs:263/265` | `UnsafeCell<OsUnfairLock>` | os_unfair_lock is OS-internally-sync. |
| `RwLock<T>` Send | `src/threading/RwLock.rs:157` | inner futex + value | `T: Send`. Std-equiv. |
| `RwLock<T>` Sync | `src/threading/RwLock.rs:158` | same | `T: Send + Sync`. Std-equiv. |
| `Semaphore` Send/Sync | `src/threading/Semaphore.rs:22-23` | OS sem | OS primitive. |
| `ThreadPool::Task` Send | `src/threading/ThreadPool.rs:337` | `Node`, `unsafe fn` ptr | Cross-thread by design; opt-out is from `*mut Node`. |
| `ThreadPool::Queue` Sync | `src/threading/ThreadPool.rs:1493` | `AtomicUsize stack`, `Cell<*mut Node> cache` | `Cell` written only by the `IS_CONSUMING`-CAS-holder; subtle but documented (lines 1488-1491). |
| `ThreadPool::Queue` Send | `src/threading/ThreadPool.rs:1494` | same | OK. |
| `dir_iterator::Name` Send/Sync (POSIX) | `src/sys/lib.rs:190/192` | `NonNull<u8>`, `len` | Lifetime-erased borrow; relies on iterator-thread-confinement caller invariant — **HAZARD: contract not enforced by type system**. |
| `DynLib` Send/Sync | `src/sys/lib.rs:5890-5891` | `*mut c_void` (dl handle) | dlopen handle; OS-internally-sync. |
| `WindowsLoop::Waker` Send/Sync | `src/io/windows_event_loop.rs:377-378` | `BackRef<WindowsLoop>` | Forwards only `wake()` on the singleton. |
| `WaiterThreadPosix::Instance` Sync | `src/spawn/process.rs:1277` | `UnsafeCell<WaiterThreadPosix>` | Sole mutator is the waiter thread; producers touch only the lock-free queue. |

### `StoreSlice<T>` Send/Sync — NOT IN SECTION P

`StoreSlice<T> Send/Sync unbounded` at `src/ast/nodes.rs:339-340` is owned by **section R (parsers-and-lang)**, not section P. The prior-audit T1 callout namechecked it, but the type is in `bun_ast`, not any section-P crate.

### `GuardedLock` `!Send` marker — STATUS: **MISSING (open PR fix unmerged)**

Open PR #30765 proposes adding `_not_send: PhantomData<*const ()>` to `GuardedLock` (the RAII guard for `GuardedBy::lock()`), but that PR is still unmerged. Current source at `src/threading/guarded.rs:132-134`:

```rust
pub struct GuardedLock<'a, Value, M: RawMutex> {
    guarded: &'a GuardedBy<Value, M>,
}
```

**No `_not_send` field.** `Mutex` is `unsafe impl Send` on Windows (`Mutex.rs:212`) and Darwin (`Mutex.rs:265`), so `&GuardedBy<…, Mutex>: Send` propagates and `GuardedLock<…, Mutex>` auto-derives `Send`. The bare `MutexGuard` (returned by `Mutex::lock_guard()`) DOES carry `_not_send` (`Mutex.rs:119`); `RwLockReadGuard`/`RwLockWriteGuard` carry it too (`RwLock.rs:245/270`). Only `GuardedLock` is missing it — the same gap the prior-audit demo PR fixed.

## `impl_streaming_writer_parent!` macro instances

Definition: `src/io/PipeWriter.rs:2623-2766` (and `impl_buffered_writer_parent!` at 2767-2899).

| caller | file:line | mode | re-entry profile |
| --- | --- | --- | --- |
| `StaticPipeWriter<P>` | `src/spawn/static_pipe_writer.rs:75-78` | `borrow = mut` | buffered; exclusive borrow inside the writer call |
| `FileSink` (out-of-section, sec. A) | `src/runtime/webcore/FileSink.rs:257` | `borrow = ptr` | freeing/re-entrant callback path |
| `Terminal` (out-of-section, sec. A) | `src/runtime/webcore.rs:226-228` | `ptr` per inline note | freeing/re-entrant |
| `IOWriter` shell (out-of-section, sec. H) | `src/runtime/shell/IOWriter.rs:1055` | `borrow = shared` | re-entry only observes `&Self` |
| `WindowsNamedPipe` (out-of-section, sec. E) | `src/runtime/socket/WindowsNamedPipe.rs:1435` | `borrow = mut` | exclusive borrow |

The macro frame stamps three `impl Trait for $Ty {…}` blocks per caller (POSIX + Windows-buffered + Windows-streaming) with ~6 `unsafe fn` headers each — these are **macro_status: MACRO_GENERATED** sites that do not appear in the per-file unsafe-keyword counts.

## dirent parser cross-platform branches

Single source: `src/sys/lib.rs::dir_iterator` (lines 146-865).

| platform | `State` struct | `next()` entry | syscall extern decl |
| --- | --- | --- | --- |
| Linux/Android | `lib.rs:322-327` | `lib.rs:338-388` | `linux_syscall::getdents64` (`src/sys/linux_syscall.rs:486-498`, `unsafe pub fn` over `libc::syscall(SYS_getdents64,…)`) |
| macOS | `lib.rs:391-398` | `lib.rs:411-510` | `__getdirentries64` extern decl inline at `lib.rs:413-419` |
| FreeBSD | `lib.rs:513-518` | `lib.rs:529-582` | `getdents` extern decl inline at `lib.rs:530-532` |
| Windows | `lib.rs:587-603` | `lib.rs:616-865` | `NtQueryDirectoryFile` via `bun_windows_sys::externs::ntdll` |

All four branches share:
- `AlignedBuf` (`lib.rs:274-294`, `#[repr(C, align(8))]` over `MaybeUninit<[u8;8192]>`).
- `unsafe fn AlignedBuf::filled(&self, len: usize) -> &[u8]` (`lib.rs:290`) — caller asserts init of `[0..len]`.
- POSIX returns `Name::borrow(name_field)` where `Name { ptr: NonNull<u8>, len }` is the lifetime-erased borrow; Windows owns `Vec<OSPathChar>` per entry.

The original T1 dirent finding (per prior audit) is rooted in **`Name`'s lifetime-erasure**: the kernel buffer is reused on the next `next()` call, but `Name` carries no `'a` parameter and is `unsafe impl Send/Sync` (POSIX). The streaming-iterator contract is comment-only (`lib.rs:155-158, 167-171`); type-system enforcement absent. The hazard is **unchanged from the audit window**.

## Notable patterns

1. **`LaunderedSelf` + `borrow = ptr` discipline** — the `impl_streaming_writer_parent!` macro encodes the “raw-`*mut Self` provenance must survive a freeing callback” invariant for FileSink-style parents. Section P only contains the macro definition and one `borrow = mut` user (`StaticPipeWriter`); the riskier `ptr`/`shared` users live in sections A/E/H.
2. **Hand-rolled lock-free queues** — `Channel<T,B>`, `ThreadPool::Queue`, `UnboundedQueue<T>` all rely on Acquire/Release ordering on a tag bit (`IS_CONSUMING` for Queue) to gate `Cell`/`UnsafeCell` access. Tree-Borrows and loom-style verification not yet performed.
3. **`unsafe extern "C"` syscall trampolines (51 sites)** — concentrated in `src/sys/{lib,linux_syscall,windows/mod,sys_uv}.rs`. Most are libc/uv signatures with full SAFETY comments; the macOS `__getdirentries64` (private libsystem symbol) is a fragile externing.
4. **EXP-002 latent `transmute`** — unreachable from current source but `pub`, one Zig-port pattern away from being introduced. Adjacent checked path (`SystemErrno::init`) exists.
5. **`AlignedBuf::filled`** as a single shared `unsafe fn` for the dirent kernel buffer — makes the four platforms' SAFETY rationales identical, but also makes any miscount of `end_index` a multi-platform UB.

## Open questions

1. Re-add the `_not_send: PhantomData<*const ()>` field to `GuardedLock` in `src/threading/guarded.rs`? The prior demo PR is unmerged or reverted; the gap is currently exposed.
2. Should the Linux `impl GetErrno for usize` route through `SystemErrno::init` even with no live caller (defense-in-depth) or stay as documented-latent?
3. Does the `bun_ptr::LaunderedSelf` trait have a written-down contract elsewhere, or only the macro-module comment in `src/io/PipeWriter.rs:2580-2604`? Phase 2 should pin this for agents.
4. The `ThreadPool::Queue::cache: Cell<*mut Node>` non-atomic read/write under the `IS_CONSUMING`-CAS — has loom (or even a manual model) ever been run on it? The SAFETY comment is a model of clarity, but the underlying invariant is exactly the kind that bites only under load.
5. Is `dir_iterator::Name`'s `unsafe impl Send/Sync` (POSIX) actually exercised by any caller? If not, we can flip it to `!Send` and erase the iterator-thread-confinement caller obligation.

## Anchor cross-refs (EXP-002)

- Witness file: `/data/projects/bun/.unsafe-audit/verification/miri-confirmed-linux-errno-transmute.md`
- Current source: `src/errno/linux_errno.rs:181-193` (anchor at line 192).
- Sibling checked path: `src/errno/lib.rs:322-333` (`SystemErrno::init`).
- Prior-audit ID: `S-001781`. The two adjacent transmutes `S-001780` (`lib.rs:310`) and `S-001782` (`windows_errno.rs:254`) are now **fronted by debug-asserted `from_raw`** — only the `usize` impl and the `lib.rs:310` `SystemErrno::from_raw` remain unchecked in release builds.
- Reproduction harness path: `/tmp/miri-repro2/src/main.rs` (per witness doc).
