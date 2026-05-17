# Phase 1 Inventory — Section D: runtime-node-compat

Run: `2026-05-15-exhaustive`. Scope: `src/runtime/node/`. Tool ritual exit codes: 0/0/0.

## Mapper tallies (audited base `origin/main@4d443e5402`)

| crate region          | files (with `unsafe`) | `unsafe (fn\|impl\|trait\|extern\|{)` keyword sites | prior-audit sites |
|-----------------------|-----------------------|----------------------------------------------------|-------------------|
| `bun_runtime::node`   | 25                    | **543**                                            | **475**           |

Delta `+68` vs prior. Drivers: (1) Section D's **own** `dir_iterator.rs` per-platform branches each emit 5–14 fresh per-record `read_unaligned`/`addr_of!` sites under the Linux/macOS/FreeBSD/Windows/WASI cfg gates; (2) the `node_fs.rs` Rust port grew a Windows-only `UVFSRequest<R, A, const F>` block (~17 paired `unsafe { uv::uv_fs_* }` call sites) that did not exist in the Zig fanout count; (3) `node_fs_watcher.rs` macro-emitted `ParentRef::from_raw_mut` / `bun_threading::Linked` shims.

SAFETY-comment density: **491 SAFETY** lines vs ~654 `unsafe` keyword occurrences (≈75%). The strongest files are `node_fs.rs` (high, comments name `Stacked-Borrows`/aliasing reasoning explicitly), `uv_signal_handle_windows.rs` (every block annotated), `dir_iterator.rs` (every read tied back to the kernel-write contract), and `path_watcher.rs` (cross-thread reasoning). Weakest: `node_os.rs` (15+ FFI blocks with WEAK SAFETY) and `node_crypto_binding.rs` (FFI thunk shapes; mostly WEAK).

## Per-file unsafe distribution

| file                                          | unsafe-keyword sites (mapper) | extern "C" decls |
|-----------------------------------------------|-------------------------------|------------------|
| `src/runtime/node/node_fs.rs`                 | 135                           | 5                |
| `src/runtime/node/path_watcher.rs`            | 54                            | 0                |
| `src/runtime/node/fs_events.rs`               | 54                            | 33               |
| `src/runtime/node/node_os.rs`                 | 53                            | 7                |
| `src/runtime/node/win_watcher.rs`             | 28                            | 3                |
| `src/runtime/node/node_fs_stat_watcher.rs`    | 28                            | 1                |
| `src/runtime/node/dir_iterator.rs`            | 26                            | 2                |
| `src/runtime/node/node_fs_watcher.rs`         | 24                            | 1                |
| `src/runtime/node/zlib/NativeZlib.rs`         | 19                            | 0                |
| `src/runtime/node/node_zlib_binding.rs`       | 18                            | 0                |
| `src/runtime/node/path.rs`                    | 15                            | 5                |
| `src/runtime/node/zlib/NativeBrotli.rs`       | 14                            | 0                |
| `src/runtime/node/node_crypto_binding.rs`     | 13                            | 6                |
| `src/runtime/node/zlib/NativeZstd.rs`         | 11                            | 0                |
| `src/runtime/node/uv_signal_handle_windows.rs`| 9                             | 6                |
| `src/runtime/node/net/BlockList.rs`           | 9                             | 0                |
| `src/runtime/node/node_process.rs`            | 8                             | 18               |
| `src/runtime/node/node_fs_binding.rs`         | 7                             | 0                |
| `src/runtime/node/types.rs`                   | 6                             | 2                |
| `src/runtime/node/buffer.rs`                  | 5                             | 1                |
| `src/runtime/node/node_cluster_binding.rs`    | 3                             | 1                |
| `src/runtime/node/node_net_binding.rs`        | 1                             | 1                |
| `src/runtime/node/node_http_binding.rs`       | 1                             | 0                |
| `src/runtime/node/StatFS.rs`                  | 1                             | 1                |
| `src/runtime/node/Stat.rs`                    | 1                             | 1                |
| **Section D**                                 | **543**                       | **94**           |

`transmute` calls: **1** (`fs_events.rs:164` — `transmute_copy::<*mut c_void, T>` of a `dlsym` result for fn-pointer typing; const-asserted size parity).
`Pin::new_unchecked` / `Pin<` sites: **0** — Section D uses **in-place RAII** (`UvFsReq`) not `Pin`, with a `Drop` impl that runs at the same address as `init` to honor libuv's self-referential pointer invariant.

## Send/Sync impls (manual cross-thread surface) — complete inventory

| impl                                              | file:line                          | bound | notes |
|---------------------------------------------------|------------------------------------|-------|-------|
| `Sync for CStrPtr`                                | `node_process.rs:91`               | (none) | `*const c_char` of a `'static` rodata NUL-terminated literal; SAFETY explicit. |
| `Send for CoreFoundation`                         | `fs_events.rs:208`                 | (none) | dlopen handle (never closed) + `extern "C" fn` ptrs + `*const CFStringRef` (framework-static). |
| `Sync for CoreFoundation`                         | `fs_events.rs:209`                 | (none) | same. |
| `Send for CoreServices`                           | `fs_events.rs:252`                 | (none) | same shape. |
| `Sync for CoreServices`                           | `fs_events.rs:253`                 | (none) | same. |
| `Linked for ConcurrentTask` (fs_events scope)     | `fs_events.rs:394`                 | (none) | `core::ptr::addr_of!((*item).next)` — UnboundedQueue contract. |
| `Linked for StatWatcher`                          | `node_fs_stat_watcher.rs:77`       | (none) | same. |
| `Linked for ResultListEntry` (in `_impl` mod)     | `node_fs.rs:2314`                  | (none) | same; SAFETY block at 2310-2313 names AtomicPtr/raw-ptr identity. |
| `Sync for PathWatcherManager`                     | `path_watcher.rs:108`              | (none) | UnsafeCell-guarded by `mutex` + `Cell<Fd>` set-once-before-spawn + AtomicBool; multi-paragraph SAFETY at 102-107. |
| `Send for PathWatcherManager`                     | `path_watcher.rs:109`              | (none) | same. |

**Note**: `node/dir_iterator.rs` does **NOT** declare `unsafe impl Send/Sync for Name` — unlike `sys/lib.rs:190/192`. Its analogous POSIX type (`IteratorResult` with `PathString`) is owned and not lifetime-erased. Its Windows type (`IteratorResultWName` with `RawSlice<u16>`) **is lifetime-erased and sendable**: `RawSlice<T>` explicitly has `unsafe impl<T: Sync> Send` and `unsafe impl<T: Sync> Sync` in `src/bun_core/lib.rs:208-212`, so `RawSlice<u16>` is `Send + Sync`. This means the streaming-iterator contract is **not** enforced by auto-trait inference. See EXP-027.

## Dirent-parser anchor (Section D scope)

Per Section P, the `sys/lib.rs` dirent parser has unchanged T1 risk. Section D adds a **second, independent** dirent parser at `src/runtime/node/dir_iterator.rs` and is the one node:fs APIs (`fs.readdir`, `fs.opendir`, the `Dir`/`Dirent` JS objects) consume.

| platform   | `NewIterator` struct        | `next()` entry  | syscall                                    |
|------------|-----------------------------|-----------------|--------------------------------------------|
| macOS      | `dir_iterator.rs:104-111`   | `:116-118`      | `__getdirentries64` (private libsystem) inline extern at `:121-132` |
| FreeBSD    | `:256-261`                  | `:264-329`      | `getdents` extern at `:244-248`            |
| Linux/And. | `:350-355`                  | `:360-435`      | `libc::syscall(SYS_getdents64, …)` at `:367-374` |
| Windows    | `:560 region` + `:578 next` | `:578-750`      | `ntdll::NtQueryDirectoryFile` (cross-crate) |
| WASI       | `:761-770`                  | `:776-859`      | `bun_sys::wasi::fd_readdir` at `:784-791`  |

Every platform branch shares:

1. `#[repr(C, align(8))] struct DirentBuf(pub [u8; 8192])` — same as Section P's `AlignedBuf` shape, but per-platform-defined locally (no shared helper). The Linux branch adds a `const _: () = assert!(align_of::<DirentBuf>() >= align_of::<libc::dirent64>())`.
2. `unsafe { self.buf.0.as_ptr().add(self.index).cast::<libc::dirent…>() }` then 4× `addr_of!((*entry).field).read_unaligned()` for `d_reclen` / `d_namlen` / `d_ino-or-d_fileno` / `d_type`. SAFETY block names "kernel wrote a valid record" and the unaligned-read rationale (`d_reclen` rounds to 4 on Darwin/FreeBSD, to 8 on Linux).
3. The `d_name` slice is then taken **directly out of `self.buf.0[name_off..name_off+name_len]`** with a normal bounds-checked slice — **never** dereferencing the raw `*const dirent`. This is a more conservative pattern than `sys/lib.rs` (which forms a `Name { ptr: NonNull<u8>, len }`).
4. Linux extra: scans `region.iter().position(|&b| b == 0)` to find the NUL inside the padded `d_name` window — a tiny extra O(reclen) scan but avoids ever reading past the kernel's filled region.

**Consumers (Section D)**:

| caller                                | file:line                                | which parser? |
|---------------------------------------|------------------------------------------|---------------|
| `node_fs.rs` (`fs.readdir`/`opendir`) | `node_fs.rs:295` (`use super::dir_iterator as DirIterator;`) — entire `Dir.read()` / `readdirInner` paths | **Section D parser** (the node one) |
| `path_watcher.rs` (`fs.watch` recurse)| `path_watcher.rs:548`                    | **Section P parser** (`sys::dir_iterator::iterate(dfd)`) |

The Section D parser returns owned `IteratorResult { name: PathString, kind }` on POSIX (no lifetime erasure — `PathString::init(name)` copies/refcounts into the heap-allocated PathString), and `IteratorResultW { name: IteratorResultWName { data: RawSlice<u16> }, kind }` on Windows (raw slice into the iterator-owned `name_data` scratch buffer, valid until next `next()`). The Windows branch is the only one where the streaming-iterator contract is observable from a consumer; both `slice()` and `slice_assume_z()` are safe methods on `&self`, with `slice_assume_z()` performing an internal unsafe conversion to `WStr`.

**Verdict — dirent consumer lifetime contract**:
- **POSIX**: upheld trivially (`PathString` owns its bytes; no shared lifetime).
- **Windows**: contract is doc-only (line 46-51 comment), and the returned `IteratorResultWName` is sendable because it wraps `RawSlice<u16>`. Current `node_fs.rs` consumers appear disciplined (they call `name.slice()` immediately and copy/transcode before the next iterator advance), but the safe API itself permits a caller to store or send the result past the iterator's next call or drop. That is a Section-D-local lifetime-erasure hazard; EXP-027 is a Miri-confirmed mirror of this API shape.
- The Section D parser is **stricter than Section P on POSIX only**: it does not form `Name { ptr, len }` references into the kernel buffer for POSIX; it copies into `PathString`. Section D-specific dirent UB risk is concentrated in **(a)** the per-platform `read_unaligned` of `d_reclen` (overflow → past-buffer index), **(b)** the Windows `IteratorResultWName` lifetime-erased/sendable result, and **(c)** the Windows `name_byte_offset + name_len_u16*2 ≤ buf.len()` clamp at `:712`, which depends on a saturating-sub arithmetic argument that holds under all input but reads slightly subtle.

## libuv FFI surface (Section D specific)

Section D is the bulk consumer of libuv's `uv_fs_*` family (Windows async fs) and `uv_signal_t` (cross-platform process signal handle). All libuv use is **gated `#[cfg(windows)]`** for fs except the cpu/os modules.

| file                                          | libuv surface                                                          | hazards |
|-----------------------------------------------|------------------------------------------------------------------------|---------|
| `node_fs.rs` (`UVFSRequest`)                  | `uv_fs_open/close/read/write/statfs` + `uv_fs_req_cleanup` callback    | Self-referential `fs_t`; **`UvFsReq` is the in-place RAII fix** (no `scopeguard` because that would relocate the 440B request). Aliasing-callback hazard explicitly avoided at `:990-992` ("`req` aliases `this.req`; once `this: &mut Self` is live, re-deriving through `req` would create a second overlapping `&mut`"). |
| `uv_signal_handle_windows.rs`                 | `uv_signal_init/start/unref/close` + `uv_close_cb` free callback       | Heap allocation handed to libuv; reclaimed in `free_with_default_allocator` close cb. PRESENT_STRONG SAFETY on every block. |
| `node_os.rs` (`cpu_infos`, `os_homedir`, etc.)| `uv_cpu_info/free_cpu_info/uv_os_homedir`                              | Buffer-lifetime contract spelled out; `uv_free_cpu_info` paired correctly. |
| `path_watcher.rs` (Windows stub)              | timestamp read of `(*this.handle.loop_).time`                          | Single deref; cross-thread read documented. |
| `win_watcher.rs`                              | `uv_fs_event_t` lifecycle, `uv_fs_event_start/stop`, `uv_close`        | `#[repr(C)]` + `uv_handle_t`-prefix via `UvHandle` trait; manager binds to one VM's `uv_loop`, mismatch is a `debug_assert`. |
| `node_fs_binding.rs`                          | `bun_vm().uv_loop()` access only                                       | thin shim. |

**Pin discipline**: Section D uses **no `Pin::new_unchecked`** and no `Pin<T>` types in any of its files. The address-stability requirement for libuv `fs_t` is encoded instead via `UvFsReq` (a `#[repr(transparent)]` newtype with a custom `Drop` that runs `uv_fs_req_cleanup(&mut self.0)` in place). The `scopeguard::guard` anti-pattern is explicitly called out in the doc comment at `node_fs.rs:311-319`. **This is the canonical Section D solution to the Pin problem and is correctly applied.**

## `repr(C)` / `repr(transparent)` / `repr(u8|u32)` FFI types

| type                                | file:line                          | category | notes |
|-------------------------------------|------------------------------------|----------|-------|
| `UvFsReq(uv::fs_t)` (windows)       | `node_fs.rs:321-322`               | `#[repr(transparent)]` | RAII wrapper; in-place Drop. |
| `NodeFS` (with `sync_error_buf` at offset 0) | `node_fs.rs:4843`         | `#[repr(C)]` | layout pinned to put `PathBuffer` at offset 0; SAFETY rationale at `:4836-4842`. |
| `Encoding`                          | `types.rs` (`#[repr(u8)]`)         | `#[repr(u8)]` | round-trip helpers match `BufferEncodingType.h`. |
| `CStrPtr(*const c_char)`            | `node_process.rs:87`               | `#[repr(transparent)]` | for `#[unsafe(no_mangle)] pub static Bun__version` exports. |
| `DirentBuf` (3 platforms)           | `dir_iterator.rs:101,253,345`      | `#[repr(C, align(8))]` | dirent alignment. |
| `EventType`                         | `node_fs_watcher.rs`               | `#[repr(u8)]` | round-trip via match arms; not from disk. |
| `Kevent` align-4                    | `path_watcher.rs`                  | `#[repr(C, align(4))]` | FreeBSD kqueue. |
| `DataDescriptor`                    | `node_fs_constant.rs`              | `#[repr(transparent)]` | bitfield wrapper. |
| `CFRunLoopSourceContext` (Darwin)   | `fs_events.rs`                     | `#[repr(C)]` | CoreFoundation v0 layout. |
| `BrotliEncoderResult` etc.          | `zlib/NativeBrotli.rs`             | `#[repr(C)]` | Brotli FFI struct. |

No `#[repr(packed)]`. No discriminant-from-disk validity hazards in Section D (the few `#[repr(u8)]` enums are runtime-constructed via match arms or from JS values; not deserialised from on-disk bytes — contrast with Section L's lockfile path).

## Notable patterns and anchors

### EXP-002 (errno transmute) — out of scope here
Section D does not touch `bun_errno`. Anchor sits in Section P.

### Section-D dirent anchor — local risk shape
The watchlist item ("dirent-parser bugs on macOS/Linux/FreeBSD per prior audit T1") manifests in Section D as the **node-side** parser. Compared to Section P's:
- **Tighter on POSIX:** no lifetime-erased `Name` type; results own their `PathString`.
- **Still hazardous on Windows:** `IteratorResultWName` is a lifetime-erased `RawSlice<u16>` over iterator scratch, and that wrapper is `Send + Sync` for `u16`.
- **Equivalent:** same `read_unaligned` discipline on the kernel record header; same alignment/over-buffer-read risk if a malicious/buggy filesystem driver returns a 0 or > buf-size `d_reclen`.
- **Wider surface:** the Windows branch is the longest (170 lines) and the most defensive (`max_name_u16().min(buf_remaining_u16)` clamp at `:709-711`); the WASI branch is unreachable in shipped builds but compiled.

### Aliasing-callback discipline (`UVFSRequest::uv_callback`)
`node_fs.rs:982-1001` and `:1003-1023` are textbook PRESENT_STRONG sites: the comment at `:988-990` names the exact Stacked-Borrows hazard ("`req` aliases `this.req` (see create(): `task.req.data = from_mut(task)`); once `this: &mut Self` is live, re-deriving through the raw `req` would create a second overlapping `&mut`"). The body goes through `this.req` instead. This is the same discipline as `impl_streaming_writer_parent!` `borrow = ptr` but hand-rolled per callback rather than macro-generated.

### `dlsym` + `transmute_copy::<*mut c_void, T>`
Only `transmute` site in Section D, at `fs_events.rs:164`. Const-asserts `size_of::<T>() == size_of::<*mut c_void>()`. Sound for fn-pointer typing (not Pod, can't go through `bytemuck`); the only caller pattern is monomorphising `T` to a `Option<unsafe extern "C" fn …>` declared by CoreFoundation/CoreServices. Acceptable.

### Buffer FFI — `Bun__Buffer_fill`
`buffer.rs:14-124` is the entire Node Buffer ↔ Uint8Array bridge in Section D. The pattern is:
- `unsafe { &*str }` to read a C++-owned `*const ZigString` (PRESENT_WEAK — caller-trust).
- `unsafe { from_raw_parts_mut(buf_ptr, fill_length) }` to materialise the destination (PRESENT_WEAK — caller-trust).
- Three macOS-only fast paths through `bun_sys::c::memset_pattern{4,8,16}` (each with its own SAFETY note).
- The bulk encoding work delegates to `webcore::encoding::write_u8/write_u16` (Section A territory) which is monomorphised over the `Encoding` enum via `dispatch_encoding!`.

The bulk of Buffer-vs-Uint8Array bridging lives in Section A's `webcore` and in C++ (`JSBuffer.cpp`), not here. Section D's `buffer.rs` is a single FFI entrypoint.

### `node_fs_watcher.rs` — `MaybeUninit<Entry>` ring
`:136 entries: [MaybeUninit<Entry>; 8]` + `:172/217 [const { MaybeUninit::uninit() }; 8]` + `:186/239 assume_init_ref` + `:243 assume_init_drop`. Standard ring-buffer pattern; per-entry initialisation is tracked by a sibling `len` field (line 130). PRESENT_STRONG. The `assume_init_drop` at 243 is gated by the `needs_free` flag in the entry — pair is well-formed.

### Macro-generated content
- `bun_threading::owned_task!(ReaddirSubtask, task);` at `node_fs.rs:2328` — stamps an `OwnedTask` `unsafe impl Send`.
- `bun_threading::owned_task!`-style `unsafe impl Linked` and `from_field_ptr!` macro invocations scattered across `node_fs_stat_watcher.rs`, `node_zlib_binding.rs`.
- `node_crypto_binding.rs` uses macro-generated `Job` `pub mod $Name { … }` per-cipher modules (~ at line 70).
- All `MACRO_GENERATED` rows in the row block are accounted for explicitly; ~25 sites total (≈5% of section).

## Open questions

1. The Section D `dir_iterator` parser is **functionally redundant** with the Section P `sys/lib.rs` parser in everything except the lifetime/ownership of the returned `Name`. Should we consolidate? The Section D POSIX version is safer (`PathString`-owned), but the Windows `IteratorResultWName` still needs a fix: either make the returned type `!Send + !Sync` and lifetime-bound, or copy into an owned UTF-16/UTF-8 buffer before exposing it. Migrating Section P consumers to the POSIX-owned pattern would erase the prior-audit T1 finding for those callers; it should not copy the current Windows `RawSlice` pattern.
2. `UvFsReq` is currently the only address-stable-libuv-request type; the `uv_signal_t` handle in `uv_signal_handle_windows.rs` is heap-allocated via `Box::<uv_signal_t>::new_uninit()` and never moved after, but the type doesn't carry a `#[repr(transparent)] Drop` analogue — should it? (Currently no `Drop` because the free is triggered by `uv_close`'s callback, not by Rust's drop.)
3. `node_os.rs:1031,1045` `unsafe { &*it }` on `*mut libc::ifaddrs` — the lifetime is the duration of one `getifaddrs/freeifaddrs` window; SAFETY comments are PRESENT_WEAK ("iface points at a live ifaddrs entry"). The `freeifaddrs` is in a separate stack frame; could a panic between `getifaddrs` and the next `freeifaddrs` leak? (Probably yes; small bound; OK for now.)
4. `node_fs.rs:7106/7197/7262/7431` raw `&mut *graph`/`&mut *raw` derefs are guarded only by the JS-thread-singleton invariant on `VirtualMachine`. PRESENT_WEAK in spots — consider replacing with the `ParentRef` / `BackRef` discipline already used elsewhere in the same file.
5. The `fs_events.rs` `dlsym`+`transmute_copy` pattern (lines 151-164) appears once but could be generalised into a `bun_sys::dlsym!` macro — currently inlined.

## Anchor cross-refs

- **Section P dirent witness file**: `/data/projects/bun/.unsafe-audit/verification/`.
- **Section D Windows witness**: `experiments/EXP-027/` + `phase5_experiment_results/EXP-027.log` (Miri mirror of `IteratorResultWName { RawSlice<u16> }` escaping iterator scratch).
- Source: `src/runtime/node/dir_iterator.rs:104-870` (per-platform branches).
- Companion Section P branches: `src/sys/lib.rs:322/391/513/587`.

## Section D row block (appended to `phase1_unsafe_surface_inventory.md`)

See aggregate inventory.
