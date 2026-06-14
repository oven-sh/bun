# Phase 2 Bucket 10: FFI Contracts — findings

Static-bucket sweeper run for Bucket 10 (UB-TAXONOMY §10): `extern "C"`
signature drift vs. C headers; `#[repr(C)]` field reorder; `#[repr(transparent)]`
wrapper over non-`Copy` by-value pass; hand-edited bindgen surrogates.
Source-tree-only (no Miri, no live `cargo +nightly check` over the whole
workspace).

Bucket 10 overlaps Bucket 21 (FFI callback aliasing), Bucket 22/Send-Sync
where the hand-rolled extern declares marker traits, and Bucket 6 (validity)
for enum-from-`c_int` round-trips. The Phase-1 Section T inventory remains the
primary reference for the C-library surface; this audit confirms its anchored
witnesses and surfaces additional layout / lint-suppression risks.

---

## Topline workspace counts

| metric | count | source |
|---|---:|---|
| `extern "C"` occurrences (all kinds) | 1657 | `rg 'extern "C"' --type rust src/ \| wc -l` |
| `extern "C" {` import blocks | 467 | `rg 'extern "C" \{'` |
| `extern "C" fn` (defs + decls) | 1026 | `rg 'extern "C" fn'` |
| `pub extern "C" fn` (exports) | 379 | `rg 'pub extern "C" fn'` |
| `unsafe extern "C" fn` (unsafe defs/decls) | 366 | `rg 'unsafe extern "C" fn'` |
| `extern "system"` blocks (Win32 ABI) | 86 | `rg 'extern "system"'` |
| `#[no_mangle]` / `#[unsafe(no_mangle)]` / `#[unsafe(export_name)]` | 516 | combined |
| `#[repr(C)]` structs/enums/unions | 827 | `rg '#\[repr\(C\)\]'` |
| `#[repr(transparent)]` newtypes | 383 | `rg '#\[repr\(transparent\)\]'` |
| `#[repr(packed)]` *actual* uses | 0 | (7 hits are all comments) |
| `assert_size!`/`assert_offset!` (layout asserts) | 74 | all in `src/libuv_sys/libuv.rs` |
| `const _: () = assert!(size_of/align_of/offset_of ...)` (manual layout asserts) | ~25 | workspace-wide |
| **bindgen invocations** | **0** | hand-written or `zig translate-c` ports only |

Per Phase-1 Section T (the bottom of the FFI stack, 15 `*_sys` crates):
**670** `unsafe` keyword occurrences; **193** `unsafe extern` block headers;
**5 cross-allocator wirings** (mimalloc + libdeflate/zlib/BoringSSL/zstd/brotli),
all paired correctly; **3 `core::arch::asm!`** sites (Win64 TEB/PEB,
ARM64 x18 TEB) all with correct `nostack, pure, readonly` options.

---

## `improper_ctypes` lint suppression coverage

`rg '#\[allow\(improper_ctypes` finds **39 sites** workspace-wide. They cluster
in three places:

| location | scope | rationale (verbatim from in-source comment) | risk |
|---|---|---|---|
| `src/jsc/cpp.rs` (file-level `#![allow(improper_ctypes, improper_ctypes_definitions, clashing_extern_declarations, …)]`) | entire generated `cpp.rs` module | "Generated raw extern surface; ABI-identical `&T` ≡ non-null `*const T`; new code must call `crate::cpp::*` rather than redeclare." | **HIGH coverage hole** — the lint cannot catch a real ABI mismatch in any `[[ZIG_EXPORT]]`-generated wrapper. Mitigation: codegen at `src/codegen/cppbind.ts` is the single source of truth. |
| `src/runtime/generated_classes.rs` (file-level same allow set) | every `${T}__fromJS` / `${T}__create` extern | "C++ stores Rust payload as opaque `void* m_ctx` and never derefs it; payload's field layout is therefore ABI-irrelevant." | **MEDIUM** — opaque-by-pointer is the contract; lint suppression hides any future case where C++ does start to deref. |
| `src/jsc/ffi_imports.rs` (`jsc_abi_extern!` macro emits `#[allow(improper_ctypes, …)]` per block) | every extern using JSC types | The macro is the *centralisation* of the suppression — instead of dozens of duplicate decls each with their own `#[allow]`, every JSC-ABI extern goes through this one macro. | **LOW** — centralisation reduces drift surface; duplicate decls become a compile error rather than silent UB. |
| 6 inline allows in `runtime/server/{server_body, mod}.rs`, `runtime/dns_jsc/dns.rs`, `jsc/{AbortSignal, CppTask, VirtualMachine, webcore_types}.rs` | per-block | Each carries an inline comment naming the opaque-pointer rationale ("opaque `void*`"; "Pointee types lack `#[repr(C)]` but are only passed by pointer"). | **LOW** when paired with `unsafe extern "C"` blocks that only traffic in `*mut`. |

**`clashing_extern_declarations`** is allowed at **2 explicit sites** plus the
two generated modules above: `src/runtime/ffi/ffi_body.rs:2760` and
`src/runtime/napi/napi_body.rs:257`. Both are the `NapiHandleScope__{open,close}`
duplicate-spelling situation (TCC injection vs canonical napi decl; pointer
types differ as `*mut c_void` vs `*mut NapiHandleScope`, but ABI-identical).

---

## Layout-assert coverage by `*_sys` crate

| crate | `#[repr(C)]` structs | size/align/offset asserts | coverage |
|---|---:|---:|---|
| `bun_libuv_sys` (`libuv.rs`) | ~30 handle/req types | **74** `assert_size!`/`assert_offset!` lines | **gold standard** — every handle, every req, every `data`/`type_`/`loop_` offset asserted at compile time; `bun_sys::windows::assert_uv_layout()` cross-validates against runtime `uv_*_size()` calls in debug builds |
| `bun_windows_sys` (`externs.rs`) | 48 | 4 (`WSADATA`, `sockaddr_storage` × size+align, `TEB.ProcessEnvironmentBlock` offset) | **weak — only the Win32 types that are passed by value carry asserts; structurally-passed-by-pointer types unverified** |
| `bun_boringssl_sys` (`boringssl.rs`) | 15 | 0 | **none** — `EVP_MD_CTX` / `HMAC_CTX` / `SHA*_CTX` POD layouts are documented but unasserted; `EVP_MD_CTX` carries an `unsafe impl Zeroable` whose SAFETY comment proves all-zero post-init, but field-by-field offsets are trust-the-header |
| `bun_libarchive_sys` (`bindings.rs`) | 1 | 0 | **none** — opaque-handle pattern dominant; `ArchiveFileSinkVTable` is Rust-defined, not a C-ABI mirror |
| `bun_zlib_sys` (`shared.rs`) | 1 (`zStream_struct`) | 0 (relies on `clashing_extern_declarations` cross-platform check) | **defensible** — the comment cites the rationale: `uLong` is `unsigned long` which varies width on LP64 vs LLP64, and the dedup'd `zStream_struct` is shared by both `posix.rs` and `win32.rs` so the lint sees both declarators as compatible |
| `runtime/napi` (`napi_body.rs`) | 5 (`napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`, `napi_node_version`, `struct_napi_module`) | 0 | **none** — N-API headers (`js_native_api.h` / `node_api.h`) are upstream-stable, but a field reorder would silently miscompile every native addon |
| `bun_mimalloc_sys`, `bun_libdeflate_sys`, `bun_lolhtml_sys`, `bun_brotli_sys`, `bun_zstd`, `bun_tcc_sys` | ~0 each | 0 each | **N/A** — opaque-handle pattern only; no value-passed POD |

**Overall:** the layout-assert pattern lives in exactly one crate
(`bun_libuv_sys`) and is the **strongest contract validation in the entire
codebase**. The pattern has not been propagated to the four other `*_sys`
crates that ship value-passed `#[repr(C)]` POD: `bun_windows_sys` (48 structs,
4 asserts ≈ 8 % coverage), `bun_boringssl_sys` (15 structs, 0 asserts),
`runtime/napi` (5 structs, 0 asserts), `bun_libarchive_sys` (1 vtable,
Rust-defined so N/A).

---

## Cross-refs to existing Section T anchors

| anchor (Phase-1 T) | confirmed Phase-2 status |
|---|---|
| **`bun_libuv_sys::libuv.rs:989`** `mem::transmute::<usize, fn(*mut T, ReturnCode)>` round-trip through `req.reserved[0]` | **SOUND but target-fragile** — the comment notes "Win64: same width" and the crate body is `cfg(windows)`-gated. Sound on the only supported target (x64/aarch64 Windows where `sizeof(usize) == sizeof(fn-pointer) == 8`). **Latent risk** on a hypothetical future 32-bit Windows-on-ARM target. Recommendation: gate with `const _: () = assert!(size_of::<usize>() == size_of::<fn(*mut (), ReturnCode)>())` to make the fragility a compile error rather than a runtime miscompile. |
| **`bun_libuv_sys::libuv.rs:623`** typed close-cb `mem::transmute<unsafe extern "C" fn(*mut Self), unsafe extern "C" fn(*mut uv_handle_t)>` | **SOUND** — `Self` is `#[repr(C)]` with `uv_handle_t` at offset 0 (encoded by `unsafe trait UvHandle`); fn-pointer ABI equality holds because both signatures take a single thin pointer argument. |
| **`bun_libuv_sys::libuv.rs:292`** `mem::transmute::<c_int, HandleType>` for `uv_guess_handle` | **SOUND** — ranged 0..=17, `HandleType` is `#[repr(C)]` with contiguous discriminants. **However**: the discriminant mapping (Async=1, Check=2, …, File=17) is **hand-transcribed from `uv.h` `UV_HANDLE_TYPE_MAP`** and is **not** asserted against the actual libuv enum at compile time. A future libuv version that reorders / inserts a discriminant would silently misclassify handles. Recommendation: add 18 `const _: () = assert!(HandleType::Tcp as c_int == 12)`-style asserts. |
| **`bun_boringssl::OPENSSL_memory_free` zero-then-free over `mi_malloc_usable_size`** | **SOUND under documented mimalloc contract** (`mi_malloc_usable_size` returns only user-accessible bytes) but the zero spans the full size-class which can be > requested. If mimalloc's invariant ever changed (e.g. metadata adjacent inside the same page), this would zero metadata. Recommendation: cite the mimalloc version pinning in the SAFETY comment so a future vendor bump triggers re-audit. |
| **`bun_boringssl_sys::sk_GENERAL_NAME_pop_free`** double `mem::transmute<fn-ptr, fn-ptr>` for `OPENSSL_sk_free_func` | **SOUND** — BoringSSL's `STACK_OF` API uses type-erased free fns with `*mut c_void` argument; both transmute directions only relax/refine the pointee type while preserving the thin-pointer fn-pointer ABI. |
| **`bun_windows_sys::teb()` / `peb()` inline `asm!`** | **SOUND** — `nostack, pure, readonly` is the correct minimal clobber list for a single-instruction segment-register read with no memory effects; `peb()` correctly returns `*const PEB` not `&'static PEB` because the OS mutates fields behind Rust's back. |

---

## New Bucket-10 findings

| F-ID | file:line | severity | bucket cross-tags | sketch |
|---|---|---|---|---|
| **F-10-1** | `src/io/source.rs:260, 270` (`Source::get_handle` / `Source::to_stream`) | LAYOUT-HARDENING / NO_EVIDENCE-CURRENT-UB | 10 + 21 | Direct `core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast()` to `*mut uv_handle_t` / `*mut uv_stream_t` **without** going through `UvHandle::as_handle_mut()` / `UvStream::as_stream()`. Phase-5 source audit verified current `Pipe` is `#[repr(C)]`, implements both marker traits, and has `Pipe.data` asserted at offset 0; the present cast is sound today. The hardening issue is that a future refactor that breaks the prefix invariant would still compile if this site keeps spelling `.cast()` directly. Fix: replace `.cast()` with `pipe.as_handle_mut()` / `pipe.as_stream()`. |
| **F-10-2** | `src/runtime/napi/napi_body.rs:512, 524, 536, 1985, 2032` (`napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`, `napi_node_version`, `struct_napi_module`) | LIKELY-LATENT-DRIFT | 10 | 5 `#[repr(C)]` POD structs declared verbatim from `js_native_api.h` / `node_api.h` with **zero layout asserts**. Every native addon compiled against Node's headers passes these by value; a field reorder or padding change in Bun's Rust mirror miscompiles every addon. **N-API is the most-ABI-stable surface in the codebase** (Node hasn't reordered these in years), but the absence of `const _: () = assert!(offset_of!(napi_property_descriptor, getter) == X)`-style asserts means the contract is documented only in the upstream header. Recommendation: add the layout-assert block at the tail of `napi_body.rs`, modelled on `bun_libuv_sys::libuv.rs:3500-3600`. |
| **F-10-3** | `src/libuv_sys/libuv.rs:257-276` (`HandleType` enum + `uv_guess_handle` transmute) | LIKELY-LATENT-DRIFT | 10 + 6 | The 18-discriminant `HandleType` enum (`Unknown` plus 17 handle kinds) is hand-transcribed from `uv.h`'s `uv_handle_type` enum (`UV_UNKNOWN_HANDLE`, the 16 `UV_HANDLE_TYPE_MAP` entries, and `UV_FILE`), but no `const _: () = assert!(HandleType::Tcp as c_int == 12)`-style assertions tie each discriminant to its upstream value. The range-checked transmute at `:292` proves "raw is in 0..=17" but **not** that the mapping is correct — an off-by-one in transcription would silently misclassify every handle (e.g. `uv_guess_handle` returning `UV_TCP=12` would produce `HandleType::Tcp` only if Bun's Rust `Tcp=12`, which is currently true but unasserted). Recommendation: 18 `const _: () = assert!(HandleType::Variant as c_int == N)` lines. |
| **F-10-4** | `src/windows_sys/externs.rs` (48 `#[repr(C)]` structs vs 4 layout asserts) | LIKELY-LATENT-DRIFT | 10 | The Win32 ABI is among the most-stable C ABIs that exists, but Bun's Rust mirrors `OVERLAPPED`, `CRITICAL_SECTION`, `FILE_NOTIFY_INFORMATION`, `INPUT_RECORD`, `WIN32_FIND_DATAW`, `addrinfo`, several `sockaddr_*` variants, `WSADATA`, and ~38 others **without size or offset asserts** beyond `WSADATA` (size only), `sockaddr_storage` (size + align), and `TEB.ProcessEnvironmentBlock` (one offset). A drift between Bun's `OVERLAPPED` declaration and `winnt.h`'s definition would silently corrupt every overlapped I/O completion. Recommendation: extend the asserted-set to every value-passed Win32 struct in `externs.rs`. |
| **F-10-5** | `src/boringssl_sys/boringssl.rs` (15 `#[repr(C)]` structs vs 0 asserts) | LIKELY-LATENT-DRIFT | 10 + 22 | `EVP_MD_CTX`, `HMAC_CTX`, `SHA_CTX` / `SHA256_CTX` / `SHA512_CTX`, and other crypto state structs are hand-rolled from `vendor/boringssl/include/openssl/*.h` **with no size asserts**. `EVP_MD_CTX` carries `unsafe impl Zeroable` whose SAFETY proves all-zero is the post-`EVP_MD_CTX_init` state — but this proof rests on Bun's field set matching BoringSSL's, which is unasserted. BoringSSL is vendored at a pinned commit and the docstring notes "When the bindgen pipeline lands this module is replaced wholesale", so the drift window is bounded, but until then a vendor update without a re-audit would corrupt every crypto operation. Recommendation: add `assert_size!` lines pinned to the vendored BoringSSL commit; cross-validate in a build-script that compiles a tiny C reflector emitting the sizeof of each struct. |
| **F-10-6** | `src/runtime/generated_host_exports.rs` and `src/runtime/generated_classes.rs` file-level `#![allow(improper_ctypes, improper_ctypes_definitions, clashing_extern_declarations)]` | DEFENSIBLE_BUT_LOAD_BEARING | 10 + 21 | Both generated modules suppress the `improper_ctypes` family for the *entire file*. The comment in `generated_classes.rs:18-24` explicitly cites the "C++ stores Rust payload as opaque `void* m_ctx` and never derefs it" rationale, so the suppression is **sound under the codegen contract**. **However**: this means rustc will never warn on a real ABI mismatch introduced by a future codegen change. The codegen scripts (`src/codegen/generate-classes.ts`, `src/codegen/generate-host-exports.ts`) are the single source of truth. Recommendation: add a generator-level lint that emits explicit `// SAFETY: payload is opaque to C++` markers per-extern, so an unexpected non-opaque payload becomes a generator-level error. |
| **F-10-7** | `src/jsc/cpp.rs` file-level `#![allow(improper_ctypes, improper_ctypes_definitions, clashing_extern_declarations)]` (~thousands of generated extern decls) | DEFENSIBLE_BUT_LOAD_BEARING | 10 | Same shape as F-10-6 — the `cppbind.ts` codegen is the source of truth and the generated module suppresses the lint for the whole file. The justification comment at `cpp.rs:32-37` notes the suppression is needed because "a handful of legacy hand-written decls (reference-typed params, `safe fn`) still exist elsewhere in `bun_jsc` and are compiled before this module". Recommendation: track the legacy hand-written decls as a beads-issue blocker for removing the `clashing_extern_declarations` allow once they're migrated. |

---

## Top 3 concerning patterns (ranked)

1. **Layout-assert coverage gap (F-10-2, F-10-4, F-10-5).** `bun_libuv_sys`
   demonstrates the right pattern with 74 `assert_size!`/`assert_offset!`
   lines; the pattern is **not propagated** to the other four `*_sys` crates
   shipping value-passed POD: `bun_windows_sys` (48 structs, 4 asserts),
   `bun_boringssl_sys` (15 structs, 0 asserts), `runtime/napi` (5 structs,
   0 asserts), `bun_libarchive_sys` (1 vtable, Rust-defined). N-API is the
   highest-leverage gap because every native addon depends on the layout
   being correct.

2. **Manual `c_int → enum` transmute without per-variant assertions (F-10-3).**
   `bun_libuv_sys::HandleType` is the canonical instance: 18 hand-transcribed
   variants, ranged-checked transmute, but no per-variant compile-time link
   to the upstream `uv.h` enum value. A future libuv update that reorders
   variants would compile cleanly and silently misclassify handles.

3. **`improper_ctypes` blanket suppression in generated modules
   (F-10-6, F-10-7).** Three large generated files (`jsc/cpp.rs`,
   `runtime/generated_classes.rs`, `runtime/generated_host_exports.rs`)
   suppress the lint at file level. The codegen contract makes this sound,
   but the lint cannot catch a real ABI mismatch — the safety proof lives
   entirely in `src/codegen/{cppbind,generate-classes,generate-host-exports}.ts`.

---

## Deliverable summary

**Total `extern "C"` decl count:** **1657** keyword occurrences workspace-wide.
Breaks down as **467** `extern "C" {}` import blocks, **1026** `extern "C" fn`
definitions/declarations, **379** of which are `pub extern "C" fn` exports;
**366** are `unsafe extern "C" fn`; **86** `extern "system"` (Win32 ABI). The
hand-rolled `*_sys` crates (15 crates, 12 449 lines) account for **193**
`unsafe extern` block headers per the Phase-1 Section T inventory.

**`improper_ctypes` lint findings:** **39** `#[allow(improper_ctypes)]`
sites; **2** explicit `#[allow(clashing_extern_declarations)]` sites plus
**3 file-level suppressions** in generated modules (`jsc/cpp.rs`,
`runtime/generated_classes.rs`, `runtime/generated_host_exports.rs`). All
suppressions carry rationale comments. The blanket file-level suppressions
are the highest-impact coverage hole: the codegen scripts are the safety
proof of record (F-10-6, F-10-7).

**Layout-assert coverage:** **`bun_libuv_sys` is the gold standard** with 74
compile-time asserts (every handle size, every prefix offset, cross-validated
against runtime `uv_*_size()`). The pattern is **not propagated** to four
other `*_sys` crates with value-passed POD: `bun_windows_sys` (48 / 4),
`bun_boringssl_sys` (15 / 0), `runtime/napi` (5 / 0), and the manual
`HandleType` enum-discriminant set in `bun_libuv_sys` itself (18 / 0).
Overall: ~74 of an estimated ~150 candidate sites = ~50 % coverage.

**Top 3 new finds:**

1. **F-10-2 — N-API `#[repr(C)]` structs lack layout asserts.** 5 structs
   (`napi_property_descriptor`, `napi_extended_error_info`, `napi_type_tag`,
   `napi_node_version`, `struct_napi_module`) are passed by value across the
   addon ABI but no `const _: () = assert!(...)` ties their offsets to the
   upstream Node.js header. Highest leverage: every native addon depends on
   this matching.

2. **F-10-3 — `HandleType` enum discriminant set unasserted.** 18 hand-
   transcribed discriminants from `uv.h`'s `uv_handle_type` enum (`UV_UNKNOWN_HANDLE`, 16 `UV_HANDLE_TYPE_MAP` entries, and `UV_FILE`); ranged
   transmute proves "raw is in 0..=17" but not that each variant maps to the
   correct upstream value. Recommendation: 18 per-discriminant compile-time asserts.

3. **F-10-1 — `Source::get_handle` / `Source::to_stream` bypass the
   `UvHandle::as_handle_mut()` discipline** (`src/io/source.rs:260, 270`)
   via direct `core::ptr::from_mut(...).cast()`. Phase-5 source audit verified
   no current UB: `Pipe` satisfies the prefix invariant today. Keep this as
   layout-drift hardening because the `unsafe trait UvHandle` machinery exists
   precisely to catch future prefix drift at compile time, and this site reaches
   around it.
