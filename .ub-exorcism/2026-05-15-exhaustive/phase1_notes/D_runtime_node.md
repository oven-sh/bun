# Section D: runtime-node-compat

## Purpose (1 source path, 25 files)

Bun's Node.js compatibility layer — every `node:fs`, `node:os`, `node:path`,
`node:process`, `node:zlib`, `node:crypto` (binding side), `node:cluster`,
`node:net` (BlockList), and the JS-visible `Buffer.fill` fast-path live here.
The section consumes Section P's `bun_sys` syscall wrappers and the libuv FFI
(`bun_sys::windows::libuv`), produces its own dirent parser (independent of
`sys/lib.rs::dir_iterator`), and bridges async fs requests through
JSC's event loop via the per-method `UVFSRequest<R, A, const F>` framework on
Windows / `AsyncFSTask<R, A, F>` on POSIX.

## Per-file unsafe-surface tally (vs prior subtotals)

| file                                             | site_count (current keyword) | prior_count | dominant_kind        | dominant_bucket(s)                          |
| ------------------------------------------------ | ---------------------------- | ----------- | -------------------- | ------------------------------------------- |
| `node_fs.rs`                                     | 135                          | (largest)   | `unsafe_block`/`fn`  | aliasing-callback, libuv FFI, MaybeUninit   |
| `path_watcher.rs`                                | 54                           |             | `unsafe_block`/`impl`| Send/Sync (manager singleton), syscall FFI  |
| `fs_events.rs`                                   | 54                           |             | `unsafe_block`       | dlsym FFI, transmute_copy, Send/Sync        |
| `node_os.rs`                                     | 53                           |             | `unsafe_block`       | libc FFI, libuv FFI                         |
| `win_watcher.rs`                                 | 28                           |             | `unsafe_block`       | libuv FFI, raw-ptr lifecycle                |
| `node_fs_stat_watcher.rs`                        | 28                           |             | `unsafe_block`/`fn`  | refcount FFI, EventLoopTimer raw-ptr        |
| `dir_iterator.rs`                                | 26                           |             | `unsafe_block`/`extern`| dirent parse (read_unaligned per-platform) |
| `node_fs_watcher.rs`                             | 24                           |             | `unsafe_block`       | MaybeUninit ring, ParentRef                 |
| `zlib/NativeZlib.rs`                             | 19                           |             | `unsafe_block`       | zlib FFI                                    |
| `node_zlib_binding.rs`                           | 18                           |             | `unsafe_block`       | JS-FFI thunks, raw-ptr deref                |
| `path.rs`                                        | 15                           |             | `unsafe_block`       | slice FFI, BunString FFI                    |
| `zlib/NativeBrotli.rs`                           | 14                           |             | `unsafe_block`       | brotli FFI                                  |
| `node_crypto_binding.rs`                         | 13                           |             | `unsafe_block`       | crypto FFI, key-derivation                  |
| `zlib/NativeZstd.rs`                             | 11                           |             | `unsafe_block`       | zstd FFI                                    |
| `uv_signal_handle_windows.rs`                    | 9                            |             | `unsafe_block`       | libuv signal handle lifecycle               |
| `net/BlockList.rs`                               | 9                            |             | `unsafe_block`       | ParentRef + JS-FFI                          |
| `node_process.rs`                                | 8                            |             | `unsafe_block`/`impl Sync`| static rodata CStrPtr                  |
| other 8 files                                    | 30                           |             | `unsafe_block`       | extern decls + JS-FFI thunks                |
| **Section D**                                    | **543**                      | **475**     | —                    | — (+68)                                     |

Delta `+68`. Drivers: per-platform `cfg`-fanout in `dir_iterator.rs` (each branch carries its own 5–14 record-header reads), the Windows `UVFSRequest` block in `node_fs.rs` (Pin-discipline-by-RAII, ~17 sites), and macro-emitted `ParentRef::from_raw_mut` / `bun_threading::owned_task!` stamps.

## Anchored watchlist status — dirent parser

The Section P findings (`Name { ptr: NonNull<u8>, len }` lifetime-erasure on POSIX + `unsafe impl Send/Sync` for the iterator's output) **do not transfer wholesale to Section D's parser** even though it serves the same kernel surface. Section D's POSIX branch is the safer of the two ports; its Windows branch has its own local lifetime-erasure issue:

- **POSIX (Linux / macOS / FreeBSD / WASI)**: returns `IteratorResult { name: PathString, kind: EntryKind }`. `PathString::init(name)` clones the kernel-buffer slice into a heap-allocated `PathString` — **no lifetime erasure**. The iterator's `buf` can be reused freely without invalidating the returned `name`.
- **Windows**: returns `IteratorResultW { name: IteratorResultWName { data: RawSlice<u16> }, kind }`. Here the `RawSlice<u16>` is a borrow into the iterator's `name_data` scratch field. It is **not** `!Send` by default: `RawSlice<T>` explicitly implements `Send + Sync` for `T: Sync` (`src/bun_core/lib.rs:208-212`), so `RawSlice<u16>` and `IteratorResultW` are sendable. Current Section D consumers (`node_fs.rs`'s readdir paths) read `name.slice()` immediately and copy/transcode before returning to JS, but the safe API boundary itself is unsound if a result is stored/sent across the next `next()` call or iterator drop. See EXP-027.
- **No local `unsafe impl Send/Sync for Name`** in Section D (contrast `sys/lib.rs:190/192`), but the shared `RawSlice<T>` unsafe impl supplies the same auto-trait exposure for the Windows result.

**Per-platform parser hazards (Section D scope)**:

| platform   | header-read site             | hazard surface |
| ---------- | ---------------------------- | -------------- |
| macOS      | `dir_iterator.rs:192-198`    | 4× `addr_of!((*entry).field).read_unaligned()` after `ptr.add(self.index).cast::<libc::dirent>()`. SAFETY block at 184-191 cites the `align(1)` + sub-`size_of::<libc::dirent>()` shape. Risk: if kernel returns `d_reclen=0`, infinite loop (no progress); if `d_reclen` overshoots `end_index`, the next iteration's `add(self.index)` is past the filled region — but is still within the 8192-byte buffer (Stacked-Borrows-clean, garbage-data-prone). |
| FreeBSD    | `dir_iterator.rs:294-299`    | Same shape. Same risks. |
| Linux      | `dir_iterator.rs:395-410`    | Stronger: aligns to 8 (kernel pads `d_reclen` to a multiple of 8), `debug_assert!(entry.is_aligned())` guards. NUL-scan over the padded region (`region.iter().position(|&b| b == 0)`) avoids over-read. |
| Windows    | `dir_iterator.rs:670-720`    | 3× `read_unaligned` for `NextEntryOffset`/`FileNameLength`/`FileAttributes`, then `bytemuck::cast_slice` over a clamped `[name_byte_offset..name_byte_offset + name_len_u16*2]` window. Defensive: clamps to `max_name_u16().min(buf_remaining_u16)`. |
| WASI       | `dir_iterator.rs:817-820`    | `read_unaligned` of full `dirent_t`; SAFETY at 812-816. Unreachable in shipped builds. |

**Consumer audit**:
- `node_fs.rs:295` — `use super::dir_iterator as DirIterator;`. Every `fs.readdir/opendir/readdirRecursive` path consumes the Section D parser. Lifetime contract upheld trivially (POSIX) or by immediate copy-out (Windows).
- `path_watcher.rs:548` — uses **Section P** parser (`sys::dir_iterator::iterate(dfd)`), inheriting Section P's hazards. Stores `entry.name.slice_u8()` only until the next `it.next()` call; never returns it to a different scope. Safe.

**Verdict**: dirent-parser-bugs anchor is **lower-risk in Section D only for POSIX**. The Section D parser's `PathString`-owned POSIX design is the future-proof template; recommend Phase 2 migrate Section P's six POSIX consumers (`glob`, `shell::builtin::{ls,rm}`, `publish_command`, `walker_skippable`, `path_watcher`) to that owned-result shape. Do **not** treat the Windows `IteratorResultWName` shape as safe: EXP-027 confirms the lifetime-erased/sendable `RawSlice<u16>` result is an unsafe safe-API contract defect.

## libuv FFI surface and contracts

Section D is the project's **largest libuv consumer** outside `bun_sys`. Three discrete usage patterns:

### 1. Async fs request (`UVFSRequest<R, A, const F>`) — `node_fs.rs:698-1074`

Per-method (open/close/read/write/statfs/…) Windows-only async wrapper. Lifecycle:
- `create()` boxes the request, transfers ownership to libuv via `bun_core::heap::release` (= `Box::leak`), stashes `from_mut::<Self>(task)` in `req.data`.
- One `uv_fs_*` call per method arm enqueues against `uv::Loop::get()`; libuv's contract is that the request memory must not move and the path argument is copied internally before return.
- `uv_callback`/`uv_callbackreq` (the C ABI completion fns) recover `this: &mut Self = bun_ptr::callback_ctx::<Self>((*req).data)` and dispatch via `NodeFS::uv_dispatch::<R, A, F>`, then enqueue a `Task` onto the JS event loop.
- `run_from_js_thread()` runs on the JS thread, scopeguard-installs `destroy()` which performs the `bun_core::heap::take(this)`-pair-with-`Box::leak`.

The PRESENT_STRONG SAFETY comments at `:988-990` and `:1010-1013` are the standout: they spell out the **exact aliasing-callback Stacked-Borrows hazard** that the macro-encoded `borrow = ptr` mode is designed to avoid. The body resolves it by hand: read `this.req.result.int()` BEFORE forming `&mut this.req`, then dispatch through the field-borrow.

### 2. In-place RAII for `uv::fs_t` — `node_fs.rs:311-351`

`UvFsReq(uv::fs_t)` is `#[repr(transparent)]` with a `Drop` that calls `self.0.deinit()` in place. The doc comment (`:311-319`) is the canonical Bun explanation of why `scopeguard::guard` is **wrong** here (libuv stores self-referential pointers; the request must not move between init and cleanup). **This is the Section D answer to the Pin problem and is correct.**

### 3. `uv_signal_t` lifecycle — `uv_signal_handle_windows.rs`

`Bun__UVSignalHandle__init` heap-allocates a `Box<uv_signal_t>::new_uninit()`, hands the raw pointer to `uv_signal_init` (which fully initialises it), then either `uv_signal_start` or — on error — `uv_close` with a `free_with_default_allocator` close-cb that does `heap::take(handle.cast())`. Every `unsafe { uv::… }` block carries an inline SAFETY comment naming the specific precondition discharged.

### Other libuv users
- `node_os.rs:677-691` — `uv_cpu_info` / `uv_free_cpu_info` paired correctly; intermediate `bun_core::ffi::slice(cpu_infos, count)` materialisation is bounded by libuv's `count` out-param.
- `node_os.rs:752-787` — `uv_os_homedir` with `out: PathBuffer`; size out-param.
- `path_watcher.rs:217` — Windows-only path: timestamp read of `(*this.handle.loop_).time`.
- `win_watcher.rs` — `uv_fs_event_t` lifecycle parallels signal handle pattern.

**libuv hazards (Section D)**:
1. `node_fs.rs:986`/`:1008` — `callback_ctx::<Self>((*req).data)` recovers a `&mut Self` whose aliasing with `req` itself is mitigated by the disjoint-field discipline at `:990-992`. **Audit-grade comment**.
2. `node_fs.rs:741` — `req: bun_core::ffi::zeroed()` initialises `uv::fs_t`. `Maybe<R>::Err(sys::Error::default())` sentinel acknowledges the niche-optimisation risk on `Result` types and overwrites before any read.
3. `uv_signal_handle_windows.rs:38` — `uv_close(signal.cast(), Some(free_with_default_allocator))` after `uv_signal_start` failure. The close-cb does the heap reclaim; correct, but the symmetric path (success then later `Bun__UVSignalHandle__close`) at `:70` repeats the pattern.

## Pin discipline

Section D contains **zero** `Pin::new_unchecked` or `Pin<T>` sites. The address-stability invariant for libuv is encoded through **in-place RAII** (`UvFsReq`) rather than Pin. The doc comment at `node_fs.rs:311-319` is the section's argument for why this is right: a `Pin<&mut T>` would still permit the caller to reach the inner `T` and `mem::swap` it (because `T = uv::fs_t` is not `!Unpin` — it lacks a `PhantomPinned` marker). Wrapping the type and providing a `Drop` that runs at the same address is stronger.

**Open question (Section D)**: should `uv::fs_t` and `uv::uv_signal_t` ship `PhantomPinned` markers at the `bun_sys` layer (Section P)? It would make the address-stability invariant type-encoded across **all** libuv-handle consumers, not just `UvFsReq`'s ad-hoc fix.

## Buffer (Node Buffer ↔ Uint8Array) bridging in Section D

Only one file: `buffer.rs:14-124`. The exported `Bun__Buffer_fill` FFI fn (`#[unsafe(export_name = "Bun__Buffer_fill")]`) receives `*const ZigString` + `*mut u8` + `usize` + `Encoding` from C++. Pattern:
- `let str = unsafe { &*str };` (PRESENT_WEAK).
- `let buf = unsafe { core::slice::from_raw_parts_mut(buf_ptr, fill_length) };` (PRESENT_WEAK).
- Dispatches to `webcore::encoding::write_u8`/`write_u16` via `dispatch_encoding!` macro (the encoder is in Section A's webcore — the U1/U2 miri-confirmed niche-vector-UB cluster lives over there, not here).
- Three macOS-only fast paths through `memset_pattern{4,8,16}` (each annotated).

**Section D Buffer hazards**: minimal. Alignment is u8→u8 (no alignment issue); the size-trust is on the C++ side; the encoder dispatch is the only place where validity-bearing types could come into play, and those are in webcore. **No Section D Buffer ↔ Uint8Array UB candidates.**

## Notable patterns

1. **`bun_ptr::callback_ctx::<T>(ptr)`** — Section D's most common boundary discharge for C-side context pointers. Appears in `node_fs.rs:986/1008`, `fs_events.rs:444`, `node_fs_watcher.rs`-style ParentRef bridges. The function is in `bun_ptr` (Section N) and is the documented entry point for "I'm at an `extern "C" fn` and the C side just handed me my own `*mut Self`". Cleaner than `&mut *(ctx as *mut T)`.
2. **`bun_core::heap::{release, take, destroy}`** triad for FFI-handed-out boxes. Section D uses `release` (= `Box::leak`) on the create side, and `take` (= `Box::from_raw`) on the destroy side. Every site is paired and commented. **No `mem::forget` calls in Section D** — the heap-take pattern is preferred.
3. **`bun_ptr::ParentRef::from_raw_mut`** — `node_fs_watcher.rs:566/762/1081`, `path_watcher.rs`, `net/BlockList.rs`. The PARENT_REF pattern (a `*mut Parent` that also carries the parent's refcount). Used wherever a Rust struct must be addressable from a JS-side closure but Box-from-raw'd on the JS side later.
4. **`scopeguard::defer!` for paired libuv calls** — `node_fs.rs:984/1006` (`uv_fs_req_cleanup`). Sound because the cleanup runs at scope exit and the request is borrowed only through `this.req`; no relocation hazard (the request is owned by the boxed `Self`, not the scopeguard).
5. **MaybeUninit ring in `node_fs_watcher.rs`** — `[MaybeUninit<Entry>; 8]` with a sibling `len` field. Per-entry `assume_init_ref` reads are gated by `i < len`; `assume_init_drop` is gated by `needs_free`. Standard, well-formed.
6. **No `transmute` (1 `transmute_copy`)** — Section D is **defensively transmute-free**, except for the dlsym fn-pointer materialisation at `fs_events.rs:164`.

## Open questions

1. Consolidate Section D and Section P dirent parsers? Section D's POSIX shape (`PathString`-owned) is strictly safer; migrating the six Section P consumers would erase the T1 finding for those call paths. The Windows `IteratorResultWName` shape must be fixed separately because it is lifetime-erased and sendable through `RawSlice<u16>`.
2. Add `PhantomPinned` to `uv::fs_t` / `uv::uv_signal_t` in `bun_sys`? Would type-encode the address-stability invariant for all libuv consumers, not just `UvFsReq`'s ad-hoc wrapper.
3. `node_fs.rs` `&mut *raw` derefs at `:7106/7197/7262/7431` (JS-thread-singleton invariant). Should we replace with the in-house `ParentRef`/`BackRef` discipline already used elsewhere in the same file?
4. `fs_events.rs`'s `dlsym` + `transmute_copy<*mut c_void, T>` is a one-off. A `bun_sys::dlsym!` macro would centralise the SAFETY note and the size-parity assert.
5. Two raw `*const c_char` `static` exports in `node_process.rs` (`Bun__version`, `Bun__version_with_sha`, etc.) carry `unsafe impl Sync for CStrPtr`. The SAFETY explicitly notes that the wrapped pointer always targets `'static` rodata produced by `concatcp!`. The pattern is sound but is a hand-rolled exception to the auto-trait machinery — could be enforced with a `bun_core::StaticCStr` newtype with a `From<&'static CStr>` constructor.

## Cross-section dependencies

- **Section P** (`bun_sys` syscalls + `dir_iterator`): Section D builds on every syscall wrapper, and one Section D consumer (`path_watcher.rs`) uses Section P's `dir_iterator` directly.
- **Section A** (`webcore`): the encoder fns (`webcore::encoding::write_u8/write_u16`) that `buffer.rs` dispatches into.
- **Section N** (`bun_core`/`bun_ptr`): `heap::{release,take,destroy}`, `ParentRef`, `BackRef`, `callback_ctx`.
- **Section K** (`jsc-core`): `JSGlobalObject`, `Strong`, `KeepAlive`, `AsyncTaskTracker`, all event-loop scheduling.
- **Section T** (`ffi-c-libs`): `bun_libuv_sys` is the underlying libuv FFI surface; Section D consumes it via `bun_sys::windows::libuv`. The zlib/brotli/zstd backends in `zlib/` consume `bun_sys::c::` (libdeflate/zlib) and the Brotli C lib.

## Anchor cross-refs

- Section P dirent witness: see `phase1_notes/P_sys_io_event_loop.md`.
- Section D's POSIX parser is the **stricter** sibling.
- Section D's Windows result has its own witness: `experiments/EXP-027/` + `phase5_experiment_results/EXP-027.log`.
- libuv FFI hazards: `node_fs.rs:984-1023` (aliasing-callback discipline), `uv_signal_handle_windows.rs:14-72` (full lifecycle annotated).
- Pin-via-RAII fix template: `node_fs.rs:311-351` (`UvFsReq`).
