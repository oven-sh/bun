# Phase-1 Inventory — Section T: ffi-c-libs

Run: `2026-05-15-exhaustive` · Sub-agent: unsafe-surface-mapper-T
Section paths: `src/libarchive/`, `src/libarchive_sys/`, `src/libdeflate_sys/`,
`src/libuv_sys/`, `src/lolhtml_sys/`, `src/mimalloc_sys/`, `src/zlib/`,
`src/zlib_sys/`, `src/zstd/`, `src/brotli/`, `src/brotli_sys/`, `src/tcc_sys/`,
`src/boringssl/`, `src/boringssl_sys/`, `src/windows_sys/`

## Totals

| metric | libarchive | libarchive_sys | libdeflate_sys | libuv_sys | lolhtml_sys | mimalloc_sys | zlib | zlib_sys | zstd | brotli | brotli_sys | tcc_sys | boringssl | boringssl_sys | windows_sys | TOTAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `unsafe` keyword occurrences | 88 | 73 | 26 | 181 | 74 | 22 | 20 | 27 | 12 | 6 | 21 | 38 | 19 | 36 | 27 | **670** |
| `unsafe { … }` blocks | 76 | 42 | 16 | 81 | 45 | 9 | 17 | 10 | 11 | 6 | 13 | 28 | 10 | 8 | 6 | **378** |
| `unsafe fn` decls | 2 | 4 | 3 | 6 | 5 | 3 | 0 | 10 | 0 | 0 | 0 | 1 | 1 | 4 | 1 | **40** |
| `unsafe extern` blocks | 9 | 26 | 7 | 46 | 22 | 10 | 3 | 6 | 1 | 0 | 8 | 9 | 3 | 23 | 20 | **193** |
| `unsafe impl` (Send/Sync/UvHandle/Zeroable) | 0 | 0 | 0 | 43 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | **47** |
| `unsafe trait` decls | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **3** |
| `asm!` / `global_asm!` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | **3** |
| `#[unsafe(no_mangle)]` exports | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | **3** |
| `// SAFETY:` comments | 87 | 43 | 14 | 80 | 42 | 9 | 17 | 11 | 11 | 7 | 13 | 27 | 10 | 5 | 5 | **381** |

Surface site count (raw `unsafe` keyword sweep): **670** vs prior partition
estimate **468** (+202, ≈ +43 %). Composition of the +202 is dominated by:

- `bun_libuv_sys` +48 — the prior counter did not weight `unsafe trait
  UvHandle/UvStream/UvReq` + 17 `unsafe impl` lines, plus the layout-assert
  macro emits accumulate.
- `bun_boringssl_sys` +21 and `bun_windows_sys` +21 — broader hand-written
  surface ahead of the bindgen pipeline; Win32 `extern "system"` block
  count grew with the porting work.
- `bun_libarchive_sys` +28, `bun_lolhtml_sys` +26 — the `*_sys` declaration
  surface broadened as more of the C ABI was wired.
- `bun_mimalloc_sys` +10, `bun_libdeflate_sys` +9, `bun_brotli_sys` +8,
  `bun_tcc_sys` +9 — same shape: more `unsafe extern "C"` block headers as
  porting completed.

SAFETY-comment density: **381 / 670 ≈ 57 %** raw — but `unsafe extern "C"`
declaration blocks (193 sites) describe the C-header contract once and don't
carry per-decl SAFETY comments. **Subtracting the 193 declaration sites,
wrapper-side coverage is 381 / 477 ≈ 80 %**, in line with Sections K/L/M/U.

## Per-row table (one row per file / cluster of unsafe surface)

| file | kind | site_count | dominant_bucket | macro_generated | safety_quality | notes |
|---|---|---:|---|---|---|---|
| `src/libarchive/lib.rs` | wrapper-side `unsafe { archive_*(...) }` blocks, `core::slice::from_raw_parts(buff, size)` for read_data_block, 9 `unsafe extern "C"` decl blocks for `archive_read_open` user-data callback shape | 88 | 21 (FFI: tar/zip), 1 (Aliasing: `*mut Archive` opaque under UnsafeCell so `&Archive` → `*mut Self` is sound), 4 (Provenance: read_data_block returns library-owned ptr — validity bounded by next API call) | source-direct | strong (87/88) — every wrapper site documents the lifetime/aliasing rule | `Archive`/`Entry` are `bun_opaque::opaque_ffi!` (UnsafeCell ZST) — `&Archive` does not assert immutability of the C-mutated state. |
| `src/libarchive_sys/bindings.rs` | translate-c port of libarchive's archive.h: 26 `unsafe extern "C"` blocks, 4 `unsafe fn`, `ArchiveFileSink` vtable (Rust-defined) | 73 | 21 (FFI), 6 (Validity: `FileType` enum from `mode_t & S_IFMT` ranged-check) | source-direct (translate-c output, hand-edited) | adequate — declaration blocks describe the contract at the top docstring, individual decls don't carry SAFETY (which is correct for FFI declarations) | `ArchiveFileSinkVTable.write_all`/`pwrite_all`/`set_offset`/`ftruncate` are `unsafe fn` pointers — caller's `owner: *mut ()` lifetime is the discipline. |
| `src/libarchive_sys/lib.rs` | crate-root re-export shim | 0 | — | — | — | 12 lines, no unsafe. |
| `src/libdeflate_sys/libdeflate.rs` | 7 `unsafe extern "C"` decls of libdeflate's compressor/decompressor APIs, `Options` struct embedding malloc/free callback fn-ptrs, `Compressor::alloc_ex` / `destroy` `unsafe fn` constructors, `load_once` allocator wiring (`libdeflate_set_memory_allocator(mi_malloc, mi_free)`) | 26 | 21 (FFI), 23 (Allocator wiring: mi_malloc + mi_free both registered) | source-direct | strong — `alloc_ex` SAFETY explicitly says "options.malloc_func/free_func (if set) must be sound allocator callbacks"; `destroy` SAFETY documents "this must come from libdeflate_alloc_compressor[_ex] and not be used after" | `Compressor` is `bun_opaque::opaque_ffi!` (UnsafeCell ZST). `pub safe fn libdeflate_alloc_compressor(c_int) -> *mut Compressor` (Rust 2024 `safe` keyword: scalar-only, returns null on OOM). |
| `src/libuv_sys/lib.rs` | crate root: re-exports + 19 cross-platform `UV_DIRENT_*` / synthetic `UV_E*` errno constants | 0 | — | — | — | Constants are platform-invariant; the `cfg(windows)` body lives in `libuv.rs`. |
| `src/libuv_sys/libuv.rs` | **the crate**: 46 `unsafe extern "C"` blocks declaring the libuv ABI (Windows-only `cfg(windows)`), **3 `unsafe trait`** + 21 `unsafe impl` of `UvHandle`/`UvStream`/`UvReq` marker traits encoding "this `#[repr(C)]` struct's prefix is `UV_HANDLE_FIELDS`/`UV_STREAM_FIELDS`/`UV_REQ_FIELDS`", `UvHandle::set_owned_data`/`take_owned_data` Box<T> round-trip helpers, `Pipe::close_and_destroy` lifecycle, `uv_guess_handle` `mem::transmute::<c_int, HandleType>` ranged-check, `uv_write` callback `mem::transmute::<usize, fn(*mut T, ReturnCode)>` (round-trips an address stored in `req.reserved[0]`), 95 `assert_size!`/`assert_offset!` layout assertions at file tail | 181 | 21 (FFI: libuv on Windows), 1 (Aliasing: handle-prefix invariant via `unsafe trait UvHandle`), 23 (Box round-trip — `Box::into_raw` at line 590, `Box::from_raw` at 608/1282/1288, all paired with `Box<T>`), 18 (transmute fn-pointer for typed close cb at 623; `c_int → HandleType` at 292 — sound, ranged), 6 (Validity: layout asserts validate every prefix at compile time) | source-direct | strong — `unsafe trait UvHandle` SAFETY says "Self must be `#[repr(C)]` and start with the same fields as `Handle`, so `*mut Self` is castable to `*mut uv_handle_t`"; every `unsafe impl` carries "all of these are `#[repr(C)]` with `UV_HANDLE_FIELDS` first"; `take_owned_data` SAFETY documents "data must either be null or the unique live pointer from a prior `set_owned_data::<T>` call with the **same** T" | The marker-trait shape is the cleanest expression of layout-prefix invariants in the codebase. The `assert_size!`/`assert_offset!` block (95 lines) is the strongest contract validation in T — `uv_handle_t` size 96, `data` at 0, `loop_` at 8, `type_` at 16, every concrete handle's prefix offsets all asserted. `bun_sys::windows::assert_uv_layout()` cross-validates against `uv_*_size()` runtime calls in debug. |
| `src/lolhtml_sys/lib.rs` | crate root re-export | 0 | — | — | — | — |
| `src/lolhtml_sys/lol_html.rs` | 22 `unsafe extern "C"` decl blocks for lol-html's C ABI, 5 `unsafe fn` (HTMLRewriter::write/end/destroy + Builder), `Opaque` blanket trait providing null-checked deref via `<*mut Self>::as_mut()` for ZST opaque handles, `ptr_without_panic` returning a static null-terminated pointer to work around lol-html's UB on `(null, 0)` (cited issue #2323) | 74 | 21 (FFI), 1 (Aliasing: `Opaque` deref through `UnsafeCell<[u8;0]>` ZST — sound, ZST has no validity beyond non-null) | source-direct (with one `lol_opaque!` macro for the Sealed-trait impls) | strong on the `Opaque::from_ptr` doc; per-call sites carry SAFETY referencing the trait | The "static `[0u8; 1]` null-terminated buffer for `(buf.is_empty())`" pattern is the kind of upstream-quirk workaround that should outlive the upstream bug fix; worth flagging for Phase-2 audit when lol-html is updated. |
| `src/mimalloc_sys/mimalloc.rs` | 10 `unsafe extern "C"` decl blocks covering the `mi_malloc`/`mi_calloc`/`mi_realloc`/`mi_free` family, `mi_heap_*` family (heap-scoped + aligned variants), `mi_theap_*` family (deprecated — per-OS-thread, do-not-cache-across-Send), `mi_option_*` (declared `pub safe fn` — scalar args, no preconditions), 3 `unsafe fn` aligned-alloc auto-routing helpers | 22 | 21 (FFI: process-global allocator) | source-direct | adequate — declaration blocks have docstrings ("No preconditions; returns null on failure"); `mi_heap_malloc_auto_align` and `mi_theap_malloc_auto_align` carry `# Safety` docs naming the heap/theap-liveness obligation. `THeap` `#[deprecated]` annotations document the per-OS-thread invariant inline | This is the global allocator backing for Bun. **Best-in-section use of `pub safe fn`**: ~25 declarations carry the Rust 2024 `safe` keyword for scalar-only / no-precondition entry points, restricting `unsafe { … }` to actual pointer-handling sites. |
| `src/mimalloc_sys/lib.rs` | crate root | 0 | — | — | — | — |
| `src/zlib/lib.rs` | wrapper crate: 3 `unsafe extern "C"` blocks (`zlibVersion` / `compress*` / `uncompress` — note: `pub safe fn zlibVersion()`, scalar args), deflate/inflate state-machine wrappers, allocator wiring (`z_stream.alloc_func = zlib_mi_malloc`, `.free_func = zlib_mi_free`) at lines 189-190 and 923-924 | 20 | 21 (FFI), 23 (Allocator pairing — both halves provided, sourced from `bun_alloc::mimalloc::mi_*`) | source-direct | strong (17/20) | Hosts the legacy `extern` block; TODO note at line 9 says "move externs to zlib_sys crate". |
| `src/zlib_sys/shared.rs` | single `zStream_struct` definition (cross-platform, deduplicated from formerly per-platform copies; comment cites `uLong` = `unsigned long` per zlib.h, varying width on LP64 vs LLP64), `unsafe impl bun_core::ffi::Zeroable for zStream_struct` | 4 | 21, 22 (Zeroable on POD `repr(C)` — SAFETY comment proves all-zero is the documented pre-`inflateInit`/`deflateInit` state, cites audit witness S021) | source-direct | strong (1/1 — Zeroable impl carries the proof) | The dedup commentary is exemplary: "win32.rs had even normalized its `struct_internal_state` to match posix so rustc's `clashing_extern_declarations` lint saw the extern fns as compatible." |
| `src/zlib_sys/posix.rs` | 5 `pub unsafe fn` `*Init` initializer wrappers (zlib's `inflateInit_`/`deflateInit_` macros expand to size-checked init calls — Rust mirrors them as `unsafe fn`), 1-2 `unsafe extern "C"` blocks | 11 | 21 (FFI) | source-direct | adequate | Each `*Init` wrapper passes `version`/`size_of::<z_stream>()` to the underlying `*Init_` C function. |
| `src/zlib_sys/win32.rs` | mirror of posix.rs for Windows | 12 | 21 (FFI) | source-direct | adequate | — |
| `src/zlib_sys/lib.rs` | crate root | 0 | — | — | — | — |
| `src/zstd/lib.rs` | wrapper + colocated extern block: opaque ZSTD_DStream/CCtx (`bun_opaque::opaque_ffi!`), one big `unsafe extern "C"` block, ZSTD_freeDStream/freeCCtx wired to Drop semantics | 12 | 21 (FFI), 23 (zstd uses internal allocator — no `ZSTD_customMem` customization, no pairing concern) | source-direct | strong (11/12) | TODO at line 9 plans to extract a `zstd_sys` crate. |
| `src/brotli/lib.rs` | wrapper: `BrotliReaderArrayList` state machine, 6 `unsafe { ... }` blocks for shared/exclusive deref of caller-owned `*mut BrotliDecoder` pinned by `&mut self`, `bun_alloc::c_thunks_for_zone!("brotli")` macro for usage tracking | 6 | 1 (Aliasing: `&*self.brotli` / `&mut *self.brotli` — SAFETY: "set exactly once in init_with_options ... brotli C API does not call back into Rust") | source-direct | strong (7/6 — over-coverage) | The "no re-entrant aliasing" claim depends on Brotli not invoking caller-supplied callbacks; current call sites pass null callbacks (default internal malloc), so the invariant holds. |
| `src/brotli_sys/brotli_c.rs` | 8 `unsafe extern "C"` decl blocks for Brotli encoder + decoder + shared-dictionary, alloc/free callback fn-ptr typedefs, `BrotliDecoder` / `BrotliEncoder` opaque ZSTs via `bun_opaque::opaque_ffi!`. Marker `pub safe fn` for query-only entry points (`BrotliDecoderHasMoreOutput(state: &BrotliDecoder)`) since the opaque is `!Freeze` | 21 | 21 (FFI), 23 (Optional alloc/free callbacks; Bun never registers them — brotli internal malloc is sole allocator) | source-direct | strong (13/21 — most uncommented sites are extern "C" decl blocks) | TODO at line 1 says "prefer generating this file via bindgen". |
| `src/brotli_sys/lib.rs` | crate root | 0 | — | — | — | — |
| `src/tcc_sys/tcc.rs` | `tcc_externs!` macro emits a single `unsafe extern "C"` block for the libtcc surface on enabled targets; on disabled targets (Android/FreeBSD/Win-arm64), emits stub `unsafe extern "C" fn` definitions calling `unreachable!()` so the link still resolves | 38 | 21 (FFI: TinyCC JIT), 18 (extern fn round-trip into `tcc_get_symbol`-returned function pointers — caller in `runtime/ffi/` validates the signature) | macro-generated (single `tcc_externs!` macro emits both arms of the cfg) | adequate | The `tcc_externs!` defensive-stub pattern is the right shape for optional FFI features and worth propagating workspace-wide. |
| `src/tcc_sys/lib.rs` | crate root | 0 | — | — | — | — |
| `src/boringssl/lib.rs` | wrapper + hand-rolled supplemental FFI subset: `is_safe_alt_name` (pure ASCII validator), `load()` one-shot init under `bun_core::run_once!`, `CtxStore(NonNull<SSL_CTX>)` with `unsafe impl Send + Sync`, `init_client` / `ssl_ctx_setup`, **3 `#[unsafe(no_mangle)] pub extern "C"` exports**: `OPENSSL_memory_alloc` (→ `mi_malloc`), `OPENSSL_memory_free` (→ `mi_free` after zeroing), `OPENSSL_memory_get_size` (→ `bun_alloc::usable_size`). Certificate-name helpers `parse_subject_alt_name` / `cn_from_subject` walking BoringSSL X509 structures | 19 | 22 (Send/Sync for CtxStore — SAFETY documents BoringSSL's internally-thread-safe SSL_CTX refcount + method tables guarded by CRYPTO_MUTEX), 23 (Allocator pairing: `OPENSSL_memory_alloc` + `OPENSSL_memory_free` both declared, paired correctly), 21 (FFI), 4 (Provenance: `core::slice::from_raw_parts(name->d.dNSName->data, length)` over BoringSSL-owned strings, lifetime bounded by `STACK_OF(GENERAL_NAME)*` parent) | source-direct | strong (10/19 — `unsafe impl Send/Sync` justification cites BoringSSL docs precisely; allocator exports documented with the BoringSSL "may hold pthreads locks" warning verbatim) | The 3 `OPENSSL_memory_*` exports are the section's only `#[unsafe(no_mangle)]` symbols. They route BoringSSL's allocator through mimalloc, **and the free path zeroes memory before freeing per the BoringSSL contract** (`OPENSSL_memory_free` is responsible for zeroing). |
| `src/boringssl_sys/boringssl.rs` | hand-rolled subset of BoringSSL's C ABI not yet bindgen'd: 23 `unsafe extern "C"` blocks, opaque type macro emitting `bun_opaque::opaque_ffi!`, **2 `core::mem::transmute::<unsafe extern "C" fn(*mut c_void), sk_GENERAL_NAME_free_func>`** for the SK_DUP_FREE callback shape (BoringSSL's `STACK_OF` type-erased free fn), `unsafe impl bun_core::ffi::Zeroable for EVP_MD_CTX` | 36 | 21 (FFI), 18 (transmute of fn-ptr signatures — sound when target is a strict subtype: takes opaque `*mut c_void` arg), 22 (Zeroable on `EVP_MD_CTX` POD — comment proves all-zero is the state `EVP_MD_CTX_init` writes; cites audit witness S021) | source-direct (with one `opaque!` macro thin sugar over `bun_opaque::opaque_ffi!`) | weak on declaration blocks (5/36 — but extern declarations describe the contract once at the top docstring, which is correct), strong on the `Zeroable` impl + transmutes | The two fn-ptr transmutes are the only transmutes in the section. Both are sound under BoringSSL's `STACK_OF` API contract: the inner free fn takes an opaque element pointer typed as `*mut c_void` so the discriminating cast is benign. |
| `src/boringssl_sys/lib.rs` | crate root | 0 | — | — | — | — |
| `src/windows_sys/externs.rs` | the crate body: 20 `unsafe extern "system"` blocks for the Win32 ABI (kernel32, ws2_32, advapi32, …), Win32 typedefs (HANDLE, DWORD, LARGE_INTEGER, …), POD `#[repr(C)]` structs (OVERLAPPED, CRITICAL_SECTION, FILE_NOTIFY_INFORMATION, …), **3 inline `core::arch::asm!` sites**: `gs:[0x30]` x86-64 TEB read (line 1574), `x18` ARM64 TEB read (line 1582), `gs:[0x60]` x86-64 PEB read (line 1600) | 27 | 21 (FFI: Win32), 18 (inline asm — clobber-correct: `nostack, pure, readonly` for one-instruction segment-register reads), 1 (Aliasing: `peb()` deliberately returns `*const PEB` not `&'static PEB` because the OS mutates fields behind Rust's back) | source-direct | strong on the asm sites (all 3 carry per-arch SAFETY citing the Windows ABI guarantee) and on `peb()` (the explicit "raw ptr not `&'static`" rationale) | **`teb()` is correctly `pub fn` (not `pub unsafe fn`)** — the precondition that the segment register / `x18` reservation is the OS thread-block pointer is guaranteed by the Windows ABI for every thread, so there is no caller obligation. The deref obligation moves to the caller of the returned `*mut TEB`. Same for `peb()`. |
| `src/windows_sys/lib.rs` | crate root | 0 | — | — | — | — |

## Bucket distribution (UB-TAXONOMY tags)

- **Bucket 21 (FFI)**: ~525 sites — by far the dominant bucket. Every
  `unsafe extern "C"`/`unsafe extern "system"` block, every wrapper-side
  `unsafe { c_function(...) }` call. Distributed roughly proportional to
  per-crate site counts.
- **Bucket 23 (Allocator pairing — UB-TAXONOMY bucket 20 in the original
  numbering)**: 5 sites of cross-allocator wiring, **all paired correctly**:
  `bun_libdeflate_sys` (mi_malloc + mi_free), `bun_zlib` (×2: read + write
  paths), `bun_boringssl` (OPENSSL_memory_alloc + _free + _get_size). Plus
  3 sites of `Box::from_raw` paired with `Box::into_raw` in
  `bun_libuv_sys::UvHandle::take_owned_data` / `Pipe::close_and_destroy`
  — sound.
- **Bucket 1 (Aliasing — Stacked/Tree Borrows)**: ~25 sites — `*mut
  Archive` / `*mut Entry` opaque deref through `UnsafeCell` (libarchive),
  `Opaque::from_ptr` for ZST handles (lol-html), `&*self.brotli` /
  `&mut *self.brotli` (brotli wrapper), `peb()` raw-ptr-not-`&'static`
  rationale. The `unsafe trait UvHandle` shape encodes layout-prefix
  invariants in the type system (the strongest aliasing-discipline pattern
  in the section).
- **Bucket 4 (Provenance — `from_raw`-shaped reslices)**: ~8 sites —
  `core::slice::from_raw_parts(buff, size)` over libarchive `read_data_block`
  output, `from_raw_parts` over BoringSSL X509 string fields, `from_raw_parts`
  over libuv `uv_buf_t`. All bounded by the next FFI call.
- **Bucket 6 (Validity)**: ~6 sites — `FileType` enum from `mode_t & S_IFMT`
  ranged-narrowing (libarchive_sys), `uv_guess_handle` `mem::transmute<c_int,
  HandleType>` ranged-check (libuv_sys, line 292), `Zeroable` impl on POD
  structs (zlib z_stream, EVP_MD_CTX).
- **Bucket 18 (transmute / inline asm)**: 6 sites — 3 `core::arch::asm!`
  in `bun_windows_sys::teb`/`peb` (clobber-correct), 2 `mem::transmute` in
  `bun_libuv_sys::libuv.rs:623, 989` (typed close-cb fn-ptr; usize → fn ptr
  round-trip), 2 `mem::transmute` in `bun_boringssl_sys` for SK_DUP_FREE
  fn-ptr shape, 1 ranged `c_int → HandleType` transmute. **All sound.**
- **Bucket 22 (Send/Sync, Zeroable)**: 4 sites — `unsafe impl Send + Sync
  for CtxStore` (boringssl/lib.rs:125-126), `unsafe impl Zeroable for
  zStream_struct` (zlib_sys/shared.rs:176), `unsafe impl Zeroable for
  EVP_MD_CTX` (boringssl_sys/boringssl.rs:168). All carry per-impl SAFETY
  proofs.
- **Bucket 23 (Layout/marker traits)**: 16 `unsafe impl UvHandle` + 2
  `unsafe impl UvStream` + N `unsafe impl UvReq` (all in
  `bun_libuv_sys::libuv.rs`) — sound under the documented "starts with
  UV_HANDLE_FIELDS" invariant + 95 layout assertions.

## Macro-generated vs source-direct

- **Source-direct unsafe**: ~98 % of T's surface. Every wrapper-side
  `unsafe { … }`, every `unsafe extern "C"` block, every layout-asserted
  `#[repr(C)]` struct.
- **Macro-generated unsafe**:
  - `bun_opaque::opaque_ffi!` (defined in `src/opaque/`, used in 12+
    sites in T) — emits `#[repr(C)] pub struct $name { _f: UnsafeCell<[u8;
    0]>, _phantom: PhantomData<(*mut u8, PhantomPinned)> }`. ZST opaque
    handles. Macro itself contains no `unsafe`; expansion contains `UnsafeCell`
    use only.
  - `bun_libuv_sys::assert_size!` / `assert_offset!` macros — emit
    compile-time layout assertions (no runtime unsafe).
  - `bun_alloc::c_thunks_for_zone!("brotli")` (used in `src/brotli/lib.rs:16`)
    — emits allocator thunks for usage tracking. Macro body lives in
    `bun_alloc`.
  - `bun_tcc_sys::tcc_externs!` (defined inline in `src/tcc_sys/tcc.rs:33-52`)
    — emits the libtcc `unsafe extern "C"` declaration block on enabled
    targets and stub `unsafe extern "C" fn ... { unreachable!() }`
    definitions on disabled targets. **The defensive-stub arm is the
    right pattern for optional FFI features.**
  - `bun_lolhtml_sys::lol_opaque!` (inline at `src/lolhtml_sys/lol_html.rs:76`)
    — emits `impl sealed::Sealed` + `impl Opaque` for the listed types. No
    `unsafe` in the expansion.
  - `bun_boringssl_sys::opaque!` (inline at `src/boringssl_sys/boringssl.rs:21`)
    — thin sugar wrapping `bun_opaque::opaque_ffi!`.
- **NOT present in T**: `impl_streaming_writer_parent!` (P), `bun_ptr::RefCounted`
  derive (B/F), `bun_dispatch::link_interface!` (F/J/K/U-emitted),
  `for_each_fs_async_op!` (F), `bun_paths::zstr!`/`wstr!` (cross-cutting).

## Anchored witness — status: **N/A — no anchored witness for Section T**

The partition's `anchored_witness: null` for T is correct. No prior
`unsafe-inventory.jsonl` finding maps directly into a single Phase-2
experiment for this section. The closest thing is the `S021`-cited
`Zeroable` impls on POD `repr(C)` structs (zlib z_stream, EVP_MD_CTX), but
both carry per-impl SAFETY proofs that the all-zero state is exactly the
documented post-init state — not a UB candidate.

## Top 3 concerning patterns (ranked)

1. **Hand-rolled `unsafe extern "C"` declaration drift risk.** Zero
   crates use `bindgen`; every `extern "C"` block is hand-edited from a
   `zig translate-c` baseline. Mitigations: (a) `bun_libuv_sys`'s 95
   `assert_size!`/`assert_offset!` block (the gold standard — should be
   replicated in `bun_boringssl_sys` and `bun_libarchive_sys` for the
   passed-by-value POD structs), (b) the cross-validation in
   `bun_sys::windows::assert_uv_layout()` against `uv_*_size()` runtime
   calls, (c) the `#[clashing_extern_declarations]` rustc lint which
   triggers across crate boundaries when shared types diverge. **Phase-2
   recommendation**: extend the layout-assert pattern to every `*_sys`
   crate that ships `#[repr(C)]` POD structs.
2. **`bun_libuv_sys::libuv.rs:989` `mem::transmute::<usize, fn(*mut T,
   ReturnCode)>` round-trip through `req.reserved[0]`.** This is the
   classic "pack a Rust fn pointer through a C-API user-data slot" shape.
   The width invariant ("Win64: same width") is documented in the comment.
   Sound today, but the transmute would be UB on any future target where
   `usize != fn-pointer-width` (none in Bun's matrix). Phase-2: consider
   replacing with `<*mut c_void as Into<...>>` shape that doesn't go
   through `usize`.
3. **`bun_boringssl::OPENSSL_memory_free` zeroing-then-freeing through
   `bun_alloc::usable_size`.** The pattern `write_bytes(ptr, 0,
   usable_size(ptr))` zeroes the *full* mimalloc usable_size, not the
   originally-requested size. mimalloc's usable_size returns the size
   class which can be larger than the request — this means mimalloc
   metadata adjacent to the allocation could be touched if `usable_size`
   ever crossed a class boundary into a metadata page. mimalloc's
   `mi_malloc_usable_size` is documented to return only the bytes safely
   accessible by the user, so this is sound under the documented contract,
   but it's worth a Phase-2 check that mimalloc's invariant is preserved
   across version updates.

## Open questions

1. **`bun_brotli`'s `c_thunks_for_zone!("brotli")` allocator thunks** —
   are they registered with brotli's C side, or is the macro decorative
   for usage tracking? I didn't find a registration site in this pass.
   Either is fine; if registered, verify both alloc + free are wired.
2. **`bun_libarchive_sys::ArchiveFileSink` lifetime discipline** — the
   vtable's `owner: *mut ()` must outlive every `archive_read_data_*`
   call. Phase 2 should verify caller discipline in `bun_libarchive`.
3. **`bun_boringssl_sys` bindgen migration timing** — when bindgen lands,
   the audit baseline shifts. Worth coordinating with the bindgen rollout.
4. **`bun_libuv_sys` consumers (Sections D + P) using the trait API** —
   if consumers reach for `(self as *mut Self).cast::<uv_handle_t>()`
   directly instead of `UvHandle::as_handle_mut()`, the layout invariant
   loses its compile-time check. Worth a Phase-2 grep.
