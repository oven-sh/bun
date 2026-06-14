# Section T: ffi-c-libs (15 crates)

## Purpose

Section T is the bottom of Bun's FFI stack: thin Rust wrappers around vendored
C libraries that Bun statically links. Three roles:

1. **Pure `*_sys` shims** — declare `extern "C"` symbols and `#[repr(C)]`
   structs that mirror the upstream C headers, plus a small amount of
   POD/Zeroable scaffolding. No higher-level logic. Crates: `bun_libarchive_sys`,
   `bun_libdeflate_sys`, `bun_libuv_sys`, `bun_lolhtml_sys`, `bun_mimalloc_sys`,
   `bun_zlib_sys`, `bun_brotli_sys`, `bun_tcc_sys`, `bun_boringssl_sys`,
   `bun_windows_sys`.
2. **Wrapper crates** — sit on top of a `*_sys` (or a colocated `extern "C"`
   block) and expose Rust-shaped `Drop`/state-machine APIs. Crates:
   `bun_libarchive` (Archiver, BufferReadStream), `bun_zlib` (deflate/inflate
   wrappers), `bun_zstd` (CCtx/DStream lifecycle), `bun_brotli`
   (BrotliReaderArrayList), `bun_boringssl` (SSL_CTX bootstrap, X.509
   helpers).
3. **Special, unique role**: `bun_mimalloc_sys` is the global allocator,
   `bun_libuv_sys` is the entire Windows event-loop ABI (libuv is Windows-only
   in this section — POSIX uses native epoll/kqueue), `bun_windows_sys` holds
   Win32 typedefs + the inline-asm `gs:[0x30]` TEB read.

The section's UB priors are exactly what you'd expect from FFI: contract
documentation, `#[repr(C)]` layout drift, and `Box::from_raw`/allocator
pairing. **Concurrency in T is "no" by partition** — the `*_sys` crates are
just symbol declarations; concurrency hazards arise only when callers invoke
the libraries from multiple threads (which is a Section P / F problem).

## Per-crate unsafe-surface tally

Prior totals (from `unsafe-inventory.jsonl`, 15 named crates): **468** sites.
This pass counts **670** keyword occurrences across `*.rs`. Delta **+202**
(≈ +43 %). Composition matches every other section so far: more `unsafe
extern "C"` block headers (each block counts as one), more `unsafe impl
Send/Sync` markers on opaque ZSTs, and `unsafe trait UvHandle` + 16
implementors (libuv) which inflated by 17 by themselves.

| crate | site_count | dominant_kind | dominant_bucket | role |
|---|---:|---|---|---|
| `bun_libarchive` | 88 (+7 vs 81) | wrapper-side `unsafe { archive_*(...) }` blocks, `core::slice::from_raw_parts(buff, size)` for libarchive's read_data_block API, 9 `unsafe extern "C"` decls (callbacks for `archive_read_open` user-data shape) | 21 (FFI), 1 (Aliasing: `*mut Archive`/`*mut Entry` UnsafeCell-opaque so `&Archive` is sound under SB), 4 (Provenance: read_data_block returns library-owned ptr — aliased between successive calls, validity bounded by next API call) | wrapper |
| `bun_libarchive_sys` | 73 (+28 vs 45) | 26 `unsafe extern "C"` blocks declaring the archive_* surface; `unsafe fn` constructors for `Archive` opaque round-tripping; one `slice_from_raw_parts(ptr, size)` over chunked-data callback buffer | 21 (FFI: tar/zip extraction), 6 (Validity: `FileType` enum from `mode_t & S_IFMT`, narrowing transmute ranged-checked) | sys |
| `bun_libdeflate_sys` | 26 (+9 vs 17) | 7 `unsafe extern "C"` decls, allocator wiring (`libdeflate_set_memory_allocator(mi_malloc, mi_free)` in `load_once`), 3 `unsafe fn` constructors | 21 (FFI), 23 (Allocator-pairing — see audit below: SOUND, mi_malloc + mi_free both registered) | sys |
| `bun_libuv_sys` | 181 (+48 vs 133) | **`unsafe trait UvHandle`** + 16 implementors + **`unsafe trait UvStream`** + 2 implementors + **`unsafe trait UvReq`** + N implementors (43 total `unsafe impl`), 46 `unsafe extern "C"` decls of the libuv ABI, `set_owned_data` / `take_owned_data` Box round-trip helpers, 6 `unsafe fn` (close_and_destroy, etc.) | 21 (FFI: libuv), 23 (Box round-trip — paired correctly via `set_owned_data`/`take_owned_data`), 1 (Aliasing: handle-prefix layout invariants encoded in `unsafe trait UvHandle`), 18 (transmute fn-pointer type for typed `close` callback at line 623 — sound under fn-pointer ABI equality) | sys (Windows-only `cfg(windows)` body) |
| `bun_lolhtml_sys` | 74 (+26 vs 48) | 22 `unsafe extern "C"` decls of lol-html's C ABI, 5 `unsafe fn` (HTMLRewriter::write/end/destroy), `Opaque::from_ptr` blanket null-checked deref helper for ZST opaque handles | 21 (FFI), 1 (Aliasing: `Opaque` trait deref through `UnsafeCell<[u8;0]>` ZST — sound, ZST has no validity) | sys |
| `bun_mimalloc_sys` | 22 (+10 vs 12) | 10 `unsafe extern "C"` decl blocks (mi_malloc family + mi_heap_* family), 3 `unsafe fn` aligned-alloc auto-routing helpers, plus heavy use of `pub safe fn` (Rust 2024 `safe` keyword) for parameter-less / scalar-only allocator entry points | 21 (FFI: process-global allocator) | sys |
| `bun_zlib` | 20 (+3 vs 17) | 3 `unsafe extern "C"` blocks declaring zlib symbols; deflate/inflate state-machine wrappers; `bun_alloc::ZlibAllocator` zlib-shaped (opaque, items*size) callbacks routed through mi_malloc | 21 (FFI), 23 (Allocator wiring: mi_malloc + mi_free assigned to `z_stream.alloc_func`/`free_func`) | wrapper |
| `bun_zlib_sys` | 27 (+6 vs 21) | 6 `unsafe extern "C"` blocks (posix.rs + win32.rs + shared.rs), 10 `pub unsafe fn` `*Init` initializer wrappers (zlib's `inflateInit_`/`deflateInit_` macros expand to size-checked init calls — Rust mirrors them as the only public unsafe entry points), 1 `unsafe impl bun_core::ffi::Zeroable for zStream_struct` | 21 (FFI), 22 (`Zeroable` marker — sound: POD with raw pointers + ints + `Option<extern fn>` + `repr(C)` enum with `Binary = 0`) | sys |
| `bun_zstd` | 12 (+1 vs 11) | one big `unsafe extern "C"` block, ZSTD_DStream/CCtx Drop wiring (ZSTD_freeDStream / ZSTD_freeCCtx), `BrotliReaderArrayList`-shaped state machine | 21 (FFI), 23 (Allocator: zstd uses its internal allocator unless `ZSTD_customMem` is set; this crate doesn't customize — sound) | wrapper |
| `bun_brotli` | 6 (-1 vs 7?) | 6 `unsafe { ... }` blocks: 2 `&self.brotli` shared-deref helpers, decoder loop with `core::slice::from_raw_parts_mut`-shaped output region | 1 (Aliasing: `&*self.brotli` / `&mut *self.brotli` over caller-owned `*mut BrotliDecoder` pinned by `&mut self`) | wrapper |
| `bun_brotli_sys` | 21 (+8 vs 13) | 8 `unsafe extern "C"` decl blocks for the Brotli encoder + decoder + shared-dictionary surface, alloc/free callback typedefs | 21 (FFI), 23 (Optional `brotli_alloc_func`/`brotli_free_func` callbacks — when null, brotli uses its internal malloc; never mixed) | sys |
| `bun_tcc_sys` | 38 (+9 vs 29) | 9 `unsafe extern "C"` decls under `tcc_externs!` macro, `unsafe fn` State helpers; **`tcc_externs!` macro emits stub `unsafe extern "C" fn` definitions on disabled targets** (Android/FreeBSD/Win-arm64) so the link still resolves and `unreachable!()` fires loudly if the runtime ENABLE_TINYCC gate ever regresses | 21 (FFI: TinyCC JIT), 18 (extern fn round-trip into `tcc_get_symbol`-returned function pointer — caller in `runtime/ffi/` validates the signature) | sys |
| `bun_boringssl` | 19 (+5 vs 14) | hand-written subset of BoringSSL not yet in `*_sys`, 2 `unsafe impl` (Send + Sync for `CtxStore(NonNull<SSL_CTX>)`), 3 `#[unsafe(no_mangle)]` `OPENSSL_memory_alloc`/`_free`/`_get_size` exports routing BoringSSL's allocator through mimalloc, certificate parsing helpers calling out to ASN1 / X509 functions | 22 (Send/Sync for `CtxStore` — SAFETY documents BoringSSL's internally-thread-safe `SSL_CTX` refcount), 23 (Allocator pairing: `OPENSSL_memory_alloc=mi_malloc`, `OPENSSL_memory_free=mi_free` — both halves declared, paired correctly), 21 (FFI), 4 (Provenance: `core::slice::from_raw_parts(name->d.dNSName->data, length)` over BoringSSL-owned strings, lifetime bounded by `STACK_OF(GENERAL_NAME)*` parent) | wrapper |
| `bun_boringssl_sys` | 36 (+21 vs 15) | 23 `unsafe extern "C"` blocks (the partial bindgen-replacement-pending hand-rolled subset), opaque type macro emitting `bun_opaque::opaque_ffi!`, 2 `core::mem::transmute::<unsafe extern "C" fn(*mut c_void), sk_GENERAL_NAME_free_func>` for the SK_DUP_FREE callback shape, 1 `unsafe impl bun_core::ffi::Zeroable for EVP_MD_CTX` | 21 (FFI), 18 (transmute of fn-ptr signatures — sound when target is a strict subtype: takes opaque `*mut c_void` arg, BoringSSL's `STACK_OF` API uses an erased free fn), 22 (Zeroable on `EVP_MD_CTX` — comment proves all-zero is the state `EVP_MD_CTX_init` writes; cited as audit witness S021) | sys |
| `bun_windows_sys` | 27 (+21 vs 6) | 20 `unsafe extern "system"` blocks (Win32 ABI), **3 `core::arch::asm!` sites**: `gs:[0x30]` x86-64 TEB read, `x18` ARM64 TEB read, `gs:[0x60]` x86-64 PEB read — all in `pub fn teb()` / `pub fn peb()` entry points. **`teb()` is itself `safe fn` (no caller obligation)** because the segment-register / `x18` reservation is guaranteed by the Windows ABI for every thread; the deref obligation moves to the caller of the returned `*mut TEB` | 21 (FFI: Win32), 18 (inline asm — clobber-correct: `nostack, pure, readonly`), 1 (Aliasing: `peb()` deliberately returns `*const PEB` not `&'static PEB` because the OS mutates fields behind Rust's back — explicit comment) | sys |
| **TOTAL** | **670** | — | — | — |

Delta vs prior 468: **+202** (≈ +43 %). Composition of the +202:

- `bun_libuv_sys`: +48 (the 17 `unsafe trait`/`unsafe impl UvHandle/UvStream/UvReq` lines were not in the prior counter; layout-assert `assert_size!`/`assert_offset!` macro emits also accumulate)
- `bun_lolhtml_sys`: +26 (more `unsafe extern "C"` block headers as the surface broadened)
- `bun_libarchive_sys`: +28 (porting in flight — the `ArchiveFileSink` vtable cycle-break adds `unsafe fn` pointers)
- `bun_boringssl_sys`: +21 (hand-rolled subset growing as more BoringSSL surface lands ahead of bindgen)
- `bun_windows_sys`: +21 (TEB/PEB asm + 20 `unsafe extern "system"` blocks)
- `bun_mimalloc_sys`: +10 (mi_heap_* family broadened)
- `bun_libdeflate_sys`: +9 (`load_once` allocator wiring split across two `unsafe extern "C"` decl blocks)
- `bun_brotli_sys`: +8 (shared-dictionary API)
- `bun_tcc_sys`: +9 (`tcc_externs!` stub-definition arm on disabled targets adds one `unsafe extern "C" fn` per declared symbol)
- `bun_boringssl`: +5
- `bun_libarchive`: +7
- `bun_zlib_sys`: +6
- `bun_zlib`: +3
- `bun_zstd`: +1

SAFETY-comment coverage: 395 / 670 ≈ **59 %**. Coverage is the worst of any
section so far, **but**: the dominant under-commented block is the `unsafe
extern "C" { ... }` declaration block — each declaration line counts as an
"unsafe site" by the keyword sweep, but FFI declarations describe the C
header contract once and don't usually carry per-line SAFETY. Subtracting
the 192 `unsafe extern` declaration sites brings the wrapper-side coverage
to 395 / 478 ≈ **83 %**, which matches Sections K/L/M.

## FFI contract documentation status

Every `*_sys` crate carries a docstring at the top citing its upstream C
header. Spot-check vs. `vendor/`:

- `bun_libuv_sys/libuv.rs:1-9` cites `src/libuv_sys/libuv.zig`; the current
  checkout also carries the generated/bundled libuv header at
  `src/jsc/bindings/libuv/uv.h`. There is no local vendor/libuv tree in
  this checkout. The
  field-by-field `assert_size!`/`assert_offset!` block at the bottom of the
  file (95 layout assertions: 30 `assert_size!`, 25 `assert_offset!`, plus
  iterations) is the strongest contract-validation in the section.
- `bun_boringssl_sys/boringssl.rs:1-7` cites `vendor/boringssl/include/openssl/*.h`
  and explicitly notes the file is **not a full bindgen dump** — it's
  a hand-curated subset Bun's Rust code consumes, replaced wholesale when
  the bindgen pipeline lands.
- `bun_zlib_sys/shared.rs:1-15`, `posix.rs`, `win32.rs` — single
  `zStream_struct` definition with a comment justifying that one
  `c_ulong`-based layout is ABI-correct on both LP64 and LLP64 (uLong is
  `unsigned long` per zlib.h, varying width).
- `bun_libarchive_sys/bindings.rs:1-9` cites `src/libarchive_sys/bindings.zig`
  (translate-c of libarchive's `archive.h`).
- `bun_mimalloc_sys/mimalloc.rs:1-9` ports `src/mimalloc_sys/mimalloc.zig`;
  the local checkout has the Rust/Zig sys crate source but no local
  vendor/mimalloc header tree.
- `bun_windows_sys/externs.rs:1-9` cites `sys/windows/windows.zig`, itself
  derived from `winnt.h` / `winbase.h` / `wincon.h` / `minwinbase.h`.

**No drift detected** in spot checks — but a full per-symbol audit against
the generated/bundled binding headers (or upstream headers when not present
in this checkout) is a Phase-2 task and beyond this surface-mapper's scope.

## bindgen vs hand-written breakdown

**Zero `bindgen` invocations workspace-wide.** All 15 crates are
hand-written or `zig translate-c` ports — no `build.rs` runs `bindgen`. The
`bindgen` mentions found in source are aspirational TODOs:

- `src/brotli_sys/brotli_c.rs:1` — `// TODO: prefer generating this file via bindgen`
- `src/boringssl/lib.rs:81-85` — "Remove once the bindgen pipeline lands these in the sys crate"
- `src/boringssl_sys/boringssl.rs:1-7` — "When the bindgen pipeline lands this module is replaced wholesale"

Implication: every `extern "C"` block in T is a hand-edited, drift-prone
artifact. The mitigations are (a) the `assert_size!`/`assert_offset!` blocks
in `bun_libuv_sys` and (b) the `bun_opaque::opaque_ffi!` macro that
centralizes the `UnsafeCell<[u8;0]>` opaque-handle pattern across 12+ types
and never asserts a size — just provides a `!Freeze` ZST behind a `*mut T`
that Rust treats as opaque.

## repr(C) layout audit summary

- **`bun_libuv_sys`** is the only crate with active runtime-asserted
  layouts. The `assert_size!` block at the tail of `libuv.rs` covers every
  handle (uv_handle_t, uv_stream_t, uv_pipe_t, uv_tcp_t, uv_tty_t, Timer,
  uv_async_t, uv_prepare_t, uv_check_t, uv_idle_t, uv_fs_poll_t,
  uv_signal_t, uv_poll_t, Process), every req (uv_read_t, uv_shutdown_t,
  uv_connect_t, uv_write_t, uv_process_exit_t, uv_udp_send_t, uv_work_t,
  fs_t), and the offsets of every field accessed by trait methods (`data`
  at offset 0 on every UvHandle implementor — the marker-trait safety
  invariant). Sizes are derived from a Windows-x64 build of libuv;
  `bun_sys::windows::assert_uv_layout()` cross-validates against runtime
  `uv_*_size()` calls in debug builds.
- **`bun_zlib_sys`** has one `zStream_struct` ABI shape used cross-platform
  (deduplicated from formerly per-platform copies; comment cites the
  rationale).
- **`bun_boringssl_sys`** — the `EVP_MD_CTX` / `HMAC_CTX` / `SHA*_CTX`
  layouts are POD `#[repr(C)]` definitions with documented field
  correspondence to `openssl/sha.h` / `openssl/evp.h`. `EVP_MD_CTX` carries
  `unsafe impl bun_core::ffi::Zeroable` with a SAFETY comment proving
  all-zero is exactly the post-`EVP_MD_CTX_init` state.
- **`bun_libarchive_sys`** — the file-sink vtable (`ArchiveFileSinkVTable`)
  is **Rust-defined**, not a C ABI mirror, so layout-drift doesn't apply
  there. The `Archive`/`ArchiveEntry` opaque types use `bun_opaque::opaque_ffi!`
  (zero-sized, `UnsafeCell<[u8;0]>`).
- Every other `*_sys` uses the opaque-handle pattern (`bun_opaque::opaque_ffi!`)
  for stateful types and `#[repr(C)]` POD only for value-passed structs.

**No drift detected in this surface pass.** Per-field validation against
upstream headers is a Phase-2 conformance task.

## Box::from_raw allocator-pairing audit

**Result: CLEAN — no Box/Vec/Arc::from_raw paired with a non-Rust
allocator.** Audit:

- `bun_libuv_sys/libuv.rs:608` — `Box::from_raw(p)` paired with
  `Box::into_raw(data)` at line 590 inside `UvHandle::set_owned_data` /
  `take_owned_data`. The pointer never originates from libuv; it always
  round-trips through `Box::into_raw`. SAFETY documents the contract:
  caller must only call `take_owned_data::<T>` when `data` was installed
  via `set_owned_data::<T>` with the **same** T.
- `bun_libuv_sys/libuv.rs:1282, 1288` — `Box::from_raw(handle)` /
  `Box::from_raw(this)` in `Pipe::close_and_destroy`. Both are paired with
  `Box<Pipe>` on the caller side; the SAFETY note explicitly says "this
  must be a Box<Pipe>-allocated pointer".
- **Allocator-pairing FFI registrations** — these are NOT Box round-trips,
  they wire C library allocators to mimalloc:
  - `bun_libdeflate_sys::libdeflate.rs:73-81` — `libdeflate_set_memory_allocator(mi_malloc, mi_free)`. Both halves provided. Sound.
  - `bun_zlib::lib.rs:189-190` (and 923-924) — `z_stream.alloc_func = zlib_mi_malloc; .free_func = zlib_mi_free`. Both halves. Sound.
  - `bun_boringssl::lib.rs:209-225` — `OPENSSL_memory_alloc` and `OPENSSL_memory_free` both `#[unsafe(no_mangle)] pub extern "C"` exports calling `mi_malloc` / `mi_free`. **Both halves declared, paired correctly.** The "size" return required by BoringSSL (`OPENSSL_memory_get_size`) uses `bun_alloc::usable_size` (mimalloc's `mi_malloc_usable_size`). Sound.
- `bun_brotli_sys` — `BrotliDecoderCreateInstance(alloc_func, free_func, opaque)` accepts allocator callbacks but Bun passes `None, None, null` everywhere (Brotli falls back to its internal malloc). No mixed-allocator path exists.
- `bun_zstd` — does not customize `ZSTD_customMem`; zstd uses its internal malloc. No pairing concern.
- `bun_brotli` (wrapper) — declares `BrotliAllocator` via `bun_alloc::c_thunks_for_zone!("brotli")` macro for tracking but does not register it with brotli's C side in the surface I audited. No pairing concern.

**Verdict: every C-allocator wiring point either provides BOTH alloc + free
functions OR provides neither. No half-paired allocators. No `Box::from_raw`
on a malloc-derived pointer.**

## Notable patterns

1. **`unsafe trait` markers (libuv)** — `pub unsafe trait UvHandle:
   Sized` + 16 implementors encodes "this `#[repr(C)]` struct starts with
   `UV_HANDLE_FIELDS`, so `*mut Self` casts to `*mut uv_handle_t`". This is
   the cleanest way to express a layout-prefix invariant in Rust. Adding a
   new uv handle type without auditing the prefix would require a deliberate
   `unsafe impl`. **Same shape for `UvStream` (2 implementors) and `UvReq`.**
2. **`bun_opaque::opaque_ffi!` macro** — used in 12+ sites across T to
   declare `#[repr(C)] pub struct $name { _f: UnsafeCell<[u8; 0]>, _phantom:
   PhantomData<(*mut u8, PhantomPinned)> }`. The `UnsafeCell` makes the type
   `!Freeze` so `&Foo` does not assert immutability of the C-owned state
   (libarchive, libdeflate, lol-html, brotli, zstd, BoringSSL all mutate
   through `&self`-shaped APIs). The `PhantomData<*mut u8>` strips
   `Send`/`Sync` so callers must explicitly opt in. ZST + align-1 + opaque
   means a non-null `*mut Foo` is always dereferenceable for 0 bytes,
   sidestepping the `dereferenceable(N)` / `noalias` aliasing requirements
   that make raw-handle FFI tricky.
3. **`pub safe fn` (Rust 2024 keyword)** — `bun_mimalloc_sys`,
   `bun_brotli_sys`, `bun_libdeflate_sys`, `bun_zlib::lib.rs`, and `bun_zstd::c`
   declare scalar-only entry points with `pub safe fn` (e.g. `mi_malloc`,
   `compressBound`, `BrotliDecoderHasMoreOutput`, `ZSTD_compressBound`).
   This is the new (Rust 2024 edition) marker for "FFI declaration whose
   contract has no unsafe preconditions". Best-practice modeling.
4. **`tcc_externs!` macro fallback stubs** — on Android / FreeBSD /
   Win-arm64 (where TinyCC isn't built), `tcc_externs!` emits stub
   `unsafe extern "C" fn $name() { unreachable!(...) }` definitions so the
   link still resolves and any future regression of the runtime
   ENABLE_TINYCC gate panics loudly instead of silently invoking UB. **This
   is the right pattern for optional FFI features** and it's worth
   propagating to similar gates (TODO: audit all `cfg.tinycc`-shaped feature
   flags for the same defensive-stub pattern).
5. **Inline asm in `bun_windows_sys::teb()` / `peb()`** — three
   `core::arch::asm!` sites (`gs:[0x30]` x86-64 TEB read, `x18` ARM64 TEB
   read, `gs:[0x60]` x86-64 PEB read), all using `nostack, pure, readonly`
   options which is the correct minimal clobber list for a single-instruction
   segment-register read with no memory effects and no flag changes. **Both
   helpers return raw pointers (`*mut TEB` / `*const PEB`), not `&'static
   TEB` / `&'static PEB`, because the OS mutates these structures behind
   Rust's back** — materializing a `&'static` would be UB under aliasing.
   `teb()` itself is correctly `pub fn` (not `pub unsafe fn`): the
   precondition "the segment register is the OS thread-block pointer" is
   guaranteed by the ABI for every thread, so there is no caller obligation
   to satisfy.

## Open questions

1. **Allocator-pairing for `bun_brotli`'s `c_thunks_for_zone!("brotli")`** —
   the macro creates allocator thunks for usage tracking but I didn't see
   them registered with brotli's C side in this pass. Either (a) brotli
   falls back to internal malloc and the thunks are decorative, or (b)
   they're registered somewhere I missed. Worth verifying in Phase 2 — if
   (b), check that both alloc + free are wired.
2. **`bun_libarchive_sys` `ArchiveFileSink` vtable lifetime** — the vtable
   contains `unsafe fn(*mut (), &[u8]) -> bool` and the `owner` is `*mut
   ()`. Caller must guarantee `owner` outlives every `archive_read_data_*`
   call. Not directly UB at this layer but worth a Phase-2 review of
   `bun_libarchive::lib.rs` callers to confirm the discipline.
3. **`bun_boringssl_sys::EVP_MD_CTX` `Zeroable` impl + cross-thread
   sharing** — the SAFETY comment proves all-zero is the post-init state
   but doesn't address "is a `Zeroed EVP_MD_CTX` legal to *use*" — caller
   must still call `EVP_DigestInit_ex` before any update. This is on the
   caller (Section J or runtime/crypto), not the sys crate.
4. **`bun_libuv_sys` is `cfg(windows)`-bodied — but the crate ships dirent
   constants used cross-platform** (`UV_DIRENT_*` constants at lib.rs:24-32
   and the synthetic `UV_E*` errnos at :42-56 are unconditionally
   compiled). Per Section D's `dirent-parser-bugs` anchor, the POSIX dirent
   parser doesn't go through `bun_libuv_sys`. The crate-level documentation
   makes this explicit. No inconsistency.
5. **Cross-section consumer validation** — Section P (sys/io/event-loop)
   and Section D (runtime/node) both consume `bun_libuv_sys` heavily; the
   trait-marker shape (`UvHandle`/`UvStream`/`UvReq`) only enforces the
   layout contract at the consuming end if callers actually use the trait
   methods rather than reaching for `(self as *mut Self).cast::<uv_handle_t>()`
   directly. Worth Phase-2 grep of consumers.
