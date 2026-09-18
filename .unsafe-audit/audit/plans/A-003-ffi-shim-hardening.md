# A-003 — FFI Shim Hardening Plan

**Cluster:** A-003 (all `*_sys` crates' `extern "C"` blocks and the thin Rust shims that wrap them)
**Classification:** **(A) STRICTLY_UNAVOIDABLE** for every site
**Refactor goal:** *None.* The `unsafe` keyword is load-bearing — `extern "C"` is the language primitive for crossing the FFI boundary. The audit's contribution at A-003 is *SAFETY-comment hardening* and *boundary-contract documentation*, not site removal.

This document scopes the hardening work for the top four `*_sys` crates by site count and proposes one per-crate template that the rest of the cluster (and any future `*_sys` crate) can be promoted to mechanically.

---

## Executive summary

The `*_sys` family — Bun's thin Rust wrappers over vendored C libraries — accounts for **~1,200+ unsafe sites** across roughly twenty crates. Verified counts from the Phase 1 inventory (`unsafe-inventory.jsonl`) for the four target crates and the next tier:

| Crate                | Sites | Library                  | Wrapping style                                  |
|----------------------|------:|--------------------------|-------------------------------------------------|
| `bun_uws_sys`        |   253 | uWebSockets / uSockets   | Hand-written, opaque-extern wrappers per object |
| `bun_libuv_sys`      |   133 | libuv (Windows)          | Hand-written, repr(C) layout-prefixed structs   |
| `bun_libarchive_sys` |    45 | libarchive               | Hand-written, `safe fn` extern + impl Archive   |
| `bun_libarchive`     |    81 | (helper crate)           | (caller-side helpers, counted at A-003 too)     |
| `bun_simdutf_sys`    |    50 | simdutf                  | Bindgen-style                                   |
| `bun_lolhtml_sys`    |    48 | lol-html                 | Hand-written                                    |
| `bun_cares_sys`      |    75 | c-ares                   | Hand-written, including `bun_cares` helpers     |
| `bun_tcc_sys`        |    29 | tinycc                   | Hand-written                                    |
| `bun_zlib_sys`       |    21 | zlib-ng                  | Hand-written                                    |
| `bun_boringssl_sys`  |    15 | BoringSSL                | Bindgen-style                                   |
| `bun_brotli_sys`     |    13 | brotli                   | Hand-written                                    |
| `bun_mimalloc_sys`   |    12 | mimalloc                 | Hand-written, opaque `Heap`                     |

**Why this is (A) and not (C).** Every site under A-003 either dereferences a C-owned pointer, calls an `extern "C"` symbol, or constructs a slice from a C-supplied `(base, len)` pair. None of these have a safe Rust replacement that is also ABI-compatible with the vendored library. Stripping the `unsafe` keyword would require *replacing the dependency*, which is out of scope by orders of magnitude.

**What the audit contributes.** Each site receives a SAFETY comment whose granularity matches the *library's* boundary contract — not the Rust expression's shape. A SAFETY comment that reads "FFI call on valid opaque libarchive handle" is structurally correct but informationally hollow: it does not name *which* C-side promise the caller is relying on, nor *which* upstream code is responsible for upholding it. The hardened comments name both, so a future reader can audit a site without re-reading the C header.

**PR strategy.** One PR per `*_sys` crate. Land smallest-first so the template iterates against feedback before being applied to the 253-site uws crate. Recommended order:

1. **`bun_mimalloc_sys`** (12 sites) — single-file, narrow API, an excellent template-validation target.
2. **`bun_libarchive_sys`** (45 sites) — already has a `safe fn` extern style; the hardening sharpens existing comments.
3. **`bun_libuv_sys`** (133 sites) — large surface, but the contract dimensions are well-documented in the libuv manual.
4. **`bun_uws_sys`** (253 sites) — large surface *and* novel contracts (uWS's SSL re-entry, WebSocket lifetimes, app-template specialization). Last so the template has matured.

Each PR is purely a comment-and-doc change. Compile time is unaffected; the only risk surface is whether a hardened comment misstates a contract — caught by the Phase 9 cross-validation pass that re-reads each comment against the corresponding C header.

**Out of scope for A-003:** Any `(C) REFACTORABLE` finding that surfaces during the comment-hardening pass (e.g. an `extern "C"` symbol that could be promoted to a `safe fn` because its parameters are scalars) is filed as a separate sub-cluster bead. A-003 stays a documentation cluster.

---

## Crate 1 — `bun_mimalloc_sys` (12 unsafe sites)

**Primary file:** `src/mimalloc_sys/mimalloc.rs` (the `lib.rs` is a 2-line module declaration; all sites are in `mimalloc.rs`).

**Wrapping style.** Hand-written, with a single opaque `Heap` type produced by `bun_opaque::opaque_ffi!`. The crate defines:

- `extern "C"` block: ~80 mimalloc symbols, no `safe fn` declarations (everything goes through `*mut Heap` + `*mut c_void`).
- Inherent `impl Heap` with thin `&mut self`-taking methods that forward to the extern symbols.
- Free-standing `pub unsafe fn` helpers (e.g. `mi_heap_malloc_auto_align`) that branch between aligned and unaligned variants based on a comptime-known minimum alignment.

**SAFETY-comment samples (verbatim, current state).**

```rust
// mimalloc.rs:114
pub fn new() -> *mut Heap {
    // SAFETY: FFI call with no preconditions.
    unsafe { mi_heap_new() }
}

// mimalloc.rs:138
pub fn realloc(&mut self, p: *mut c_void, newsize: usize) -> *mut c_void {
    // SAFETY: `self` is a live `*mut Heap`; `p` is null or was allocated by this heap.
    unsafe { mi_heap_realloc(self, p, newsize) }
}

// mimalloc.rs:535 (inside `mi_heap_malloc_auto_align`)
// SAFETY: caller guarantees `heap` is live.
```

**Quality assessment.** The comments name the right preconditions but elide three contract dimensions mimalloc actually documents in `mimalloc.h`: (a) `mi_heap_malloc` is *thread-affine* to the heap's owning thread; (b) `realloc` semantically frees `p` on success so the caller must not retain it; (c) the returned pointer is aligned to `MI_MAX_ALIGN_SIZE` only when `size >= MI_MAX_ALIGN_SIZE`. None of these are stated in the existing SAFETY comments.

**Boundary-contract dimensions for mimalloc.**

1. **Liveness.** The `*mut Heap` was returned by `mi_heap_new` / `mi_heap_new_ex` and has not been passed to `mi_heap_delete` or `mi_heap_destroy`.
2. **Thread affinity.** Per-heap APIs (`mi_heap_malloc`, `mi_heap_calloc`, …) must run on the heap's owning thread. The default heap (`mi_heap_get_default`) is thread-local; treating it as `Sync` is UB.
3. **Ownership transfer on realloc.** A successful `mi_*realloc*` invalidates the old pointer. On null return, the old pointer is *not* freed (mimalloc's contract differs from `realloc(3)` on some platforms — `mi_reallocf` does free).
4. **Alignment.** The aligned variants require `alignment` to be a power of two AND ≥ `sizeof(void*)`. The unaligned variants guarantee `MI_MAX_ALIGN_SIZE` only when the request is large enough.
5. **Heap-of-origin for `realloc`/`free`.** `mi_heap_realloc(heap, p, n)` requires `p` to have been allocated *by `heap` or one of its child heaps*. Cross-heap realloc is UB.
6. **`#[global_allocator]` interaction.** Bun uses mimalloc as the global allocator, so `Box::new(...)` and `mi_malloc(...)` produce interchangeable pointers (a property Bun relies on in `bun_core::heap`).

**Hardened SAFETY-comment template.**

```rust
// SAFETY: mimalloc(<symbol>) — <which dimensions apply>
//   - heap-live:    `<param>` came from mi_heap_new[_ex] and is not yet deleted/destroyed
//   - thread:       caller is on the heap's owning thread (heap is `!Send` by Bun convention)
//   - origin:       (for free/realloc) `<ptr>` was allocated by this heap or its children
//   - alignment:    (for *_aligned) `<align>` is a power of two AND ≥ sizeof(void*)
//   - transfer:     (for realloc) on success the previous pointer is invalidated
//                   and must not be retained; on null return the old pointer is preserved
```

**Worked example: hardening `realloc`.**

Before:
```rust
pub fn realloc(&mut self, p: *mut c_void, newsize: usize) -> *mut c_void {
    // SAFETY: `self` is a live `*mut Heap`; `p` is null or was allocated by this heap.
    unsafe { mi_heap_realloc(self, p, newsize) }
}
```

After:
```rust
pub fn realloc(&mut self, p: *mut c_void, newsize: usize) -> *mut c_void {
    // SAFETY: mimalloc(mi_heap_realloc) —
    //   - heap-live: `self` is `&mut Heap`, which by construction is a live
    //     `mi_heap_t` (no public `Heap` constructor; the only producers are
    //     `Heap::new` → `mi_heap_new` and `mi_heap_new_ex`).
    //   - thread:    `&mut Heap` is `!Send` (the wrapper is `!Sync` and the
    //     receiver pins us to the owning thread for the call).
    //   - origin:    caller invariant — `p` is null or was returned by a
    //     previous `mi_heap_*alloc*(self, ...)` (or one of `self`'s child
    //     heaps); cross-heap realloc is UB.
    //   - transfer:  on non-null return, `p` is invalidated (the caller must
    //     replace it with the return value before any further use). On null
    //     return, `p` is preserved — use `mi_heap_reallocf` for the freeing
    //     variant.
    unsafe { mi_heap_realloc(self, p, newsize) }
}
```

The hardened comment lengthens the source by ten lines but makes the audit obligation locally checkable: a reviewer never has to consult `mimalloc.h` to validate the call. The same template applies uniformly to the remaining 11 sites.

**Hardening bead count for the crate:** 12.

---

## Crate 2 — `bun_libarchive_sys` (45 unsafe sites in `bindings.rs`; 81 more in the `bun_libarchive` helper crate)

**Primary file:** `src/libarchive_sys/bindings.rs` (~93 KB; the `lib.rs` is a 2-line re-export and the `.zig` sibling is the original Zig port that no longer compiles).

**Wrapping style.** Hand-written, leans on Rust's `unsafe extern "C" { safe fn … }` to declare value-typed symbols as `safe fn` whenever the C side has no pointer preconditions. Examples from the extern block:

```rust
unsafe extern "C" {
    safe fn archive_version_string() -> *const c_char;
    safe fn archive_version_details() -> *const c_char;
    safe fn archive_read_support_filter_lzma(a: &Archive) -> ArchiveResult;
    // …
}
```

The `&Archive` parameter pattern works because `Archive` is an opaque-extern ZST with an `UnsafeCell<[u8;0]>` and is `!Freeze`, so the `&Archive` is ABI-identical to a non-null `*const`/`*mut archive`. This keeps ~90% of the API safe at the call site and concentrates `unsafe` in the handful of pointer-out-param functions.

**SAFETY-comment samples (verbatim).**

```rust
// bindings.rs:474
pub fn version_string() -> &'static [u8] {
    // SAFETY: archive_version_string returns a static NUL-terminated C string.
    unsafe { bun_core::ffi::cstr(archive_version_string()) }.to_bytes()
}

// bindings.rs:528
pub fn write_set_options(&self, opts: &ZStr) -> ArchiveResult {
    // SAFETY: FFI call on valid opaque libarchive handle.
    unsafe { archive_write_set_options(self.as_mut_ptr(), opts.as_ptr().cast()) }
}

// bindings.rs:779
// SAFETY: libarchive guarantees buff[0..size] is valid until the next read call.
let ptr = buff.cast::<u8>();
let bytes = core::ptr::slice_from_raw_parts(ptr, size);
```

**Quality assessment.** The two extremes are visible here. The static-C-string sites have a sufficient one-liner because the contract is universally true and well-known. The handle-passing sites and the slice-from-(buff,size) site, by contrast, paper over real contract structure: libarchive's read API has a documented *lifetime cliff* (the buffer is valid until the *next call into the same `Archive`*), and the existing comment names the cliff but not the structural guarantee Bun is relying on (that the caller in `bun_libarchive` never holds the slice across a re-entry).

**Boundary-contract dimensions for libarchive.**

1. **Handle liveness and mode.** Every `archive_*` function takes a `struct archive*` that was allocated via `archive_read_new`, `archive_write_new`, or `archive_write_disk_new` and is in a compatible mode for the call (e.g. `archive_read_next_header` requires a *read*-allocated archive).
2. **Read/write monodirection.** A read archive cannot accept `archive_write_*` calls and vice versa. The C side does runtime tag checks and returns `ARCHIVE_FATAL` rather than crashing, but mixing the modes is a Rust-side contract bug.
3. **Pointer lifetime cliffs.** `archive_read_data_block` returns a `(buff, size, offset)` triple where `buff` is valid *only until the next call into the same archive* (any libarchive function on the handle, not just `read_data_block`). `archive_error_string` returns a `'static`-like pointer that is *not* `'static` — it points to a per-archive scratch buffer that is overwritten on the next error. `archive_entry_*` getters return pointers that live as long as the `archive_entry`, which is owned by the parent archive and freed on `archive_read_free`.
4. **NUL-termination on inputs.** Every `*const c_char` parameter must be NUL-terminated. Bun feeds `&ZStr` (a NUL-terminated string view) to most of these, which makes the precondition compile-checked.
5. **Reentrancy from the sink vtable.** `Archive::read_data_into_fd` calls back into Rust via the `ArchiveFileSinkVTable`. The vtable's `unsafe fn` slots are reachable from inside an `unsafe extern "C"` libarchive read frame, so Rust panics across the vtable boundary would unwind through C — Bun must `catch_unwind` at the vtable entry (currently absent; flagged for a Phase 8 hardening bead).
6. **Result-code semantics.** `ArchiveResult` is `i32`-valued with sentinel values `OK=0`, `EOF=1`, `RETRY=-10`, `WARN=-20`, `FAILED=-25`, `FATAL=-30`. `FATAL` means the handle is unrecoverable; subsequent calls on it must be confined to teardown (`archive_free`).
7. **Filename encoding.** libarchive expects platform-default-encoded paths. Bun normalizes to UTF-8 on POSIX and to UTF-16 via a separate code path on Windows; the `_w` variants of libarchive functions are used for the latter.

**Hardened SAFETY-comment template.**

```rust
// SAFETY: libarchive(<symbol>) — <which dimensions apply>
//   - handle-live: `<param>` is a live `struct archive` in the correct mode
//                  (read / write / write_disk) for this call
//   - lifetime:    (for *_data_block / error_string / entry_* getters) the
//                  returned pointer is valid only until <named cliff>; the
//                  caller MUST NOT escape it past <named operation>
//   - nul-term:    `<ptr>` is NUL-terminated (ZStr invariant / caller-supplied)
//   - encoding:    paths are <platform-default | UTF-16> per the called symbol
//   - result:      caller checks ArchiveResult; FATAL renders the handle
//                  unusable for anything except `archive_free`
```

**Worked example: hardening the slice-from-buff site.**

Before:
```rust
// SAFETY: libarchive guarantees buff[0..size] is valid until the next read call.
let ptr = buff.cast::<u8>();
let bytes = core::ptr::slice_from_raw_parts(ptr, size);
```

After:
```rust
// SAFETY: libarchive(archive_read_data_block) —
//   - handle-live: `self` is a live read-mode `struct archive` (Archive
//     wrapper invariant).
//   - lifetime:    `buff` points into libarchive's internal decode buffer.
//     It is valid until the next call into THIS archive handle (not just
//     the next `read_data_block`; any `archive_*(self, ...)` invalidates
//     it). The returned `*const [u8]` is fat-but-uneferenced; the caller
//     in `bun_libarchive` re-checks freshness before forming a `&[u8]`
//     and does NOT cross an arbitrary FFI boundary while holding the
//     slice. See `Block` struct doc-comment for the propagation rules.
//   - size:        libarchive sets `size` in the same call; we trust the
//     write-through (`&raw mut size` was the out-param). A size of 0 is
//     legal and yields an empty slice via `slice_from_raw_parts`'s
//     zero-length aliasing relaxation.
let ptr = buff.cast::<u8>();
let bytes = core::ptr::slice_from_raw_parts(ptr, size);
```

**Hardening bead count for the crate:** 45 (sites in `bindings.rs`); a sibling bead enumerates the 81 caller-side sites in `bun_libarchive`.

---

## Crate 3 — `bun_libuv_sys` (133 unsafe sites in `libuv.rs`)

**Primary file:** `src/libuv_sys/libuv.rs` (~134 KB). The crate is Windows-only (`#[cfg(windows)]` at the module body); a small POSIX-visible header lives in `lib.rs` exporting `uv_dirent_type_t` and the synthetic `UV_E*` errno constants.

**Wrapping style.** Hand-written. The defining structural choice is **layout-prefixed handle types**: every concrete handle (`Pipe`, `Timer`, `uv_async_t`, …) is `#[repr(C)]` and begins with `uv_handle_t`'s fields, so a `*mut Pipe` is castable to `*mut uv_handle_t` and the cast is enforced by the `unsafe trait UvHandle` marker. This pattern shapes every shim in the file.

Notable derived patterns:

- Thread-local per-worker loop initialization via `THREADLOCAL_LOOP` + `THREADLOCAL_LOOP_DATA` (libuv.rs:415-460). The TLS storage is the loop body, not just a pointer.
- `UvHandle::set_owned_data<T>(Box<T>)` / `take_owned_data<T>()` — the centralized `Box::into_raw` / `Box::from_raw` round-trip for the `handle->data = bun.new(T, …)` pattern. Every other crate that owns libuv handle userdata routes through these two methods.
- `uv_guess_handle` is wrapped to range-check the discriminant before the `mem::transmute` to `HandleType`, avoiding the latent UB that a future libuv enum addition would cause.

**SAFETY-comment samples (verbatim).**

```rust
// libuv.rs:165 (uv_buf_t::slice)
// SAFETY: caller-supplied (base, len); valid for the buffer's lifetime.
unsafe { core::slice::from_raw_parts(self.base, self.len as usize) }

// libuv.rs:290 (uv_guess_handle)
// SAFETY: `HandleType` is `#[repr(C)]` with contiguous discriminants
// 0..=17 and `raw` was just range-checked into that interval.
unsafe { mem::transmute::<c_int, HandleType>(raw) }

// libuv.rs:420 (Loop::get TLS init)
// SAFETY: TLS slot is per-thread; no aliasing. `uv_loop_init`
// accepts uninitialized storage (it zero-fills internally).
// Escaping the pointer past `.with()` is intentional: the slot is
// const-initialized POD with no TLS destructor (static-asserted
// above), so its address is stable for the thread lifetime.

// libuv.rs:619 (UvHandle::close)
// SAFETY: `Self` embeds `uv_handle_t` at offset 0; cb is ABI-identical.
```

**Quality assessment.** This crate is the strongest current example in Bun's `*_sys` family. The TLS comment and the `mem::transmute` comment both name the *structural* property the call relies on (TLS-storage stability, contiguous repr-C discriminants) rather than just restating "the pointer is valid." The 133-site backlog is therefore not about *adding* missing information — it is about promoting the median comment quality (`// SAFETY: self is a live loop.`, repeated dozens of times) up to the level of the best ones.

**Boundary-contract dimensions for libuv.**

1. **Loop ownership and thread affinity.** A `uv_loop_t` is owned by exactly one OS thread. All non-`*_async_*` APIs on a handle must be invoked on the loop's owning thread. `uv_async_send` is the documented escape hatch; everything else is racy.
2. **Handle lifecycle and the close cycle.** A handle moves through `init → (start/stop)* → close → close_cb fires → memory may be freed`. Freeing memory before the close-cb fires is UB; libuv keeps internal pointers to the handle until then. Bun centralizes the `Box::from_raw` reclamation inside `take_owned_data` precisely to make the close-cb path the single freeing site.
3. **Layout-prefix discipline.** Every `uv_<kind>_t` is layout-prefixed with `uv_handle_t`. The `unsafe impl UvHandle for X {}` declaration is the audit obligation for that property; a violation (e.g. inserting a field before `data`) is silent UB.
4. **Request lifetime.** `uv_req_t`-derived types (`uv_write_t`, `uv_connect_t`, `uv_fs_t`, …) must outlive the operation. Stack-allocating a request is fine only when the caller blocks; Bun's async paths heap-allocate via `bun_core::heap::into_raw`.
5. **Callback nullability.** Most `*_cb` typedefs are `Option<unsafe extern "C" fn(...)>`. Passing `None` is legal and means "no callback"; the runtime API differences are documented per-symbol.
6. **`uv_buf_t` zero-length aliasing.** libuv frequently returns `{base: NULL, len: 0}` (e.g. declined `alloc_cb`, `uv_buf_init(NULL, 0)`). `core::slice::from_raw_parts` rejects a null base even with `len == 0`, so every uv-buf-to-slice site must guard the empty case (the current `uv_buf_t::slice()` does so explicitly).
7. **`ReturnCode` errno encoding.** libuv error codes are returned as small *negative* `c_int`s; the unsigned-absolute value is the errno. The `ReturnCode` newtype encodes this, and `raw_errno()` is the canonical extractor.
8. **Windows handle semantics.** On Windows, `uv_pipe_t::handle` is a `HANDLE` (i.e. `void*`), not a file descriptor; the layout prefix differs from POSIX libuv. This crate compiles only on Windows, so the cross-platform consideration is whether *consumers* assume libuv-on-POSIX semantics.

**Hardened SAFETY-comment template.**

```rust
// SAFETY: libuv(<symbol>) — <which dimensions apply>
//   - loop-thread:  caller is on the loop's owning thread (Loop is `!Send`
//                   by `THREADLOCAL_LOOP` construction)
//   - handle-live:  `<handle>` was init'd via `uv_<kind>_init`, has not yet
//                   reached its `close_cb`, and the close walk has not
//                   started for the parent loop
//   - layout:       `Self: UvHandle` — `#[repr(C)]` with `uv_handle_t`'s
//                   fields at offset 0 (the cast `*mut Self -> *mut uv_handle_t`
//                   is therefore well-formed)
//   - req-lifetime: (for uv_*_t requests) `<req>` was heap-allocated via
//                   `bun_core::heap::into_raw` and is reclaimed only in
//                   the matching completion callback
//   - buf-empty:    (for uv_buf_t -> slice) `(NULL, 0)` is handled before
//                   any `from_raw_parts` call (libuv routinely emits it)
//   - cb-null:      passing `None` is documented at the libuv symbol level
```

**Worked example: hardening the loop tick site.**

Before:
```rust
#[inline]
pub fn tick(&mut self) {
    // SAFETY: self is a live loop.
    let _ = unsafe { uv_run(self, RunMode::Default) };
}
```

After:
```rust
#[inline]
pub fn tick(&mut self) {
    // SAFETY: libuv(uv_run) —
    //   - handle-live: `self` is `&mut Loop`; the only producer of a `&Loop`
    //     in this crate is `Loop::get()`, which `uv_loop_init`s a TLS slot
    //     on first call and never replaces it. Liveness lasts the thread
    //     lifetime (no TLS destructor — static-asserted at libuv.rs:393).
    //   - loop-thread: `Loop` is implicitly `!Send` (TLS storage). The
    //     `&mut self` borrow pins us to the calling thread.
    //   - reentrance: `uv_run` may invoke pending handle callbacks, all of
    //     which are layout-prefixed `uv_<kind>_t`s whose userdata Bun owns
    //     via `set_owned_data<T>`. Re-entering `tick` from within a callback
    //     is documented-OK by libuv but rare in Bun (the event-loop driver
    //     does not).
    let _ = unsafe { uv_run(self, RunMode::Default) };
}
```

**Hardening bead count for the crate:** 133. Per the inventory, ~80 of these are the `// SAFETY: self is a live loop.` one-liners; promoting them to the template is the bulk of the work.

---

## Crate 4 — `bun_uws_sys` (253 unsafe sites across 22 files)

**Primary files.** The crate is unique among the four targets in being *multi-file*. The top contributors are:

| File                          | Unsafe sites |
|-------------------------------|-------------:|
| `Loop.rs`                     |  56 |
| `WebSocket.rs`                |  51 |
| `h3.rs`                       |  39 |
| `thunk.rs`                    |  28 |
| `Response.rs`                 |  27 |
| `SocketGroup.rs`              |  25 |
| `us_socket_t.rs`              |  23 |
| `App.rs`                      |  18 |
| `SocketContext.rs`            |  16 |
| `lib.rs` (crate root)         |  10 |

The `lib.rs` is where the cross-cutting opaque types live — `us_loop_t`, `us_socket_context_t`, plus the `UpgradedDuplex` / `WindowsNamedPipe` cycle-break shims that link back up into `bun_runtime` via `extern "C"` symbols exposed by `#[no_mangle]`.

**Wrapping style.** The richest of the four. Three patterns coexist:

1. **Opaque-extern handles via `bun_core::opaque_extern!`** — used for object types whose layout Bun never inspects (`us_loop_t`, `us_socket_context_t`, …). The macro emits a `repr(C)` ZST with `UnsafeCell<[u8;0]>`, which makes `&T`/`&mut T` ABI-identical to a non-null pointer. This is what lets `lib.rs` declare value-typed shims as `safe fn` and drop the per-call-site `unsafe { }` for the simple inherent methods.
2. **Hand-written wrappers around C++-template instantiations** — `Response<const SSL: bool>` is the canonical example: the C++ side is `uws::Response<true>` / `uws::Response<false>`, the Rust side carries the SSL flag as a const generic and forwards through `c::uws_res` (the type-erased C handle). Each shim takes a `const fn ssl_flag()` and passes it as the first argument, mirroring the C++ template parameter.
3. **Per-callsite trampoline synthesis for handler-typed parameters** — `Response::on_writable<U, H>` synthesizes a local `extern "C" fn handle<U, H, const SSL: bool>(...)` and coerces it to the C-ABI fn pointer. The trampoline asserts `H: ZST` via `thunk::zst::<H>()`, so the user's handler is monomorphized in with no runtime storage. Each such site introduces a fresh `unsafe { ... }` block whose contract is "uWS callback contract — `this` is live for the call, `H` is a ZST handler."

**SAFETY-comment samples (verbatim).**

```rust
// Loop.rs:186
// SAFETY: self is a valid loop pointer
unsafe { c::us_wakeup_loop(self) };

// Loop.rs:278
// SAFETY: `this` is the live C-allocated loop pointer per fn contract.
unsafe { c::uws_loop_addPostHandler(this, ctx, callback) };

// Response.rs:351
// SAFETY: uWS callback contract — `this` is live for the call, `H`
// is a ZST handler (asserted in `thunk::zst`).
unsafe {
    thunk::zst::<H>()(
        data.cast::<U>(),
        amount,
        thunk::handle_mut(Response::<SSL>::cast_res(this)),
    )
}

// lib.rs:68 (us_bun_verify_error_t::code)
// SAFETY: uSockets guarantees a non-null `code` is a valid
// NUL-terminated C string that outlives this struct (it points into
// BoringSSL's static error table). Lifetime narrowed to `&self`.
Some(unsafe { core::ffi::CStr::from_ptr(self.code) })
```

**Quality assessment.** The lib.rs and the trampoline-synthesis sites are already very good. The Loop.rs sites are the worst offenders: dozens of identical `// SAFETY: self is a valid loop pointer` one-liners that omit the *structural* property the call relies on (the loop is C-allocated and held by raw pointer, never aliased into a `&Loop` reborrow that would invalidate later writes through the pointer — a constraint that *does* show up in the documentation block at Loop.rs:262-272 but does not propagate to the per-call SAFETY comments). The audit's contribution to uws is to lift that documentation block's prose down into each site that depends on it.

**Boundary-contract dimensions for uWebSockets/uSockets.**

1. **Loop ownership.** `us_loop_t` is created by `us_create_loop` and is C-owned. It is *not* TLS like libuv's loop; it lives at a heap address that callers hold by raw pointer. Routing through a `&mut Loop` reborrow is correct for *call* sites but unsafe to *store* — see Loop.rs:262-272 for the canonical explanation.
2. **SSL re-entry.** uWS's `Response<SSL = true>` calls into BoringSSL which can re-enter Rust via configured verify callbacks. SAFETY comments at SSL-touching sites must mention re-entrance because `&mut Response` cannot be re-formed inside a re-entrant callback.
3. **Socket-context lifetimes.** `us_socket_context_t` (the old type that the crate now exposes as an opaque handle for back-compat — actual sockets belong to `SocketGroup`s) outlives every socket it parents. Closing a context invalidates every child.
4. **Per-callback `this` liveness.** uWS guarantees a callback's `this`-style argument (e.g. `*mut uws_res`) is live for the *duration of the call*. It is NOT live across yields back to the loop. SAFETY comments at trampoline bodies must reference this windowed liveness, not unconditional liveness.
5. **WebSocket message buffer lifetime.** uWS hands message bytes to the message handler with a `(ptr, len)` pair valid only for the call. The handler must copy if it wants to retain. This is the WebSocket equivalent of libarchive's `read_data_block` cliff.
6. **App template specialization.** `App<const SSL: bool>` and its `Response<SSL>` siblings are monomorphized; the `SSL` discriminant flows through every call as the first `i32` argument. A const-generic mismatch is silent UB at the C++ side (wrong template instantiation reached).
7. **Cross-thread `wake`.** `us_wakeup_loop` is the documented thread-safe entry point. Every other uSockets function is loop-thread-only. The audit's SAFETY comment template needs to make this distinction explicit (it currently does not — `wakeup` shares the boilerplate of `tick`).
8. **`!Freeze` opaque ABI.** The opaque-extern handle pattern relies on `UnsafeCell<[u8;0]>`. This makes `&Handle` and `&mut Handle` carry neither `readonly` nor `noalias` LLVM attributes, which is what lets the `safe fn` extern declarations be sound. The contract is type-level, but a future refactor that swaps `UnsafeCell<[u8;0]>` for `[u8;0]` would silently break the ABI.

**Hardened SAFETY-comment template.**

```rust
// SAFETY: uws(<symbol>) — <which dimensions apply>
//   - loop-live:    `<loop>` was returned by `us_create_loop`/`uws_get_loop`
//                   and not yet passed to `us_loop_free`
//   - loop-thread:  caller is on the loop's owning thread; this is NOT the
//                   thread-safe surface (use `us_wakeup_loop` for that)
//   - this-window:  (for callback trampolines) `this` is live for THIS call
//                   only; do not retain past the body. uWS may free it
//                   before our return on the error/close paths
//   - ssl-flag:     (for App<SSL>/Response<SSL>) the const-generic `SSL`
//                   matches the C++ template instantiation behind the handle
//   - msg-buffer:   (for WebSocket message handlers) `(ptr, len)` is valid
//                   for THIS call; the handler must copy to retain
//   - reentry:      (for SSL paths) the call may re-enter Rust via the
//                   configured verify callback; `&mut Response` cannot be
//                   re-formed inside the re-entry — pass `*mut` through
//   - opaque-abi:   (for opaque-extern shims) `&Handle` is ABI-identical to
//                   a non-null pointer because `Handle: !Freeze` via
//                   `UnsafeCell<[u8;0]>`; do not relax that field type
//   - cross-thread: ONLY `us_wakeup_loop` is documented thread-safe; every
//                   other symbol is loop-thread-only
```

**Worked example: hardening the trampoline body.**

Before:
```rust
extern "C" fn handle<U, H, const SSL: bool>(
    this: *mut c::uws_res,
    amount: u64,
    data: *mut c_void,
) -> bool
where
    H: Fn(*mut U, u64, &mut Response<SSL>) -> bool + Copy + 'static,
{
    if data.is_null() {
        return true;
    }
    // SAFETY: uWS callback contract — `this` is live for the call, `H`
    // is a ZST handler (asserted in `thunk::zst`).
    unsafe {
        thunk::zst::<H>()(
            data.cast::<U>(),
            amount,
            thunk::handle_mut(Response::<SSL>::cast_res(this)),
        )
    }
}
```

After:
```rust
extern "C" fn handle<U, H, const SSL: bool>(
    this: *mut c::uws_res,
    amount: u64,
    data: *mut c_void,
) -> bool
where
    H: Fn(*mut U, u64, &mut Response<SSL>) -> bool + Copy + 'static,
{
    if data.is_null() {
        return true;
    }
    // SAFETY: uws(uws_res_on_writable trampoline) —
    //   - this-window: uWS invokes this callback with `this` pointing at the
    //     live `uws::Response<SSL>` instance whose `onWritable` slot we
    //     registered. The pointer is valid for the duration of this call.
    //     uWS may close the response and free `this` BEFORE our return on
    //     the error path; the body never retains the `&mut Response` past
    //     the synchronous handler invocation, so the close-during-call is
    //     not aliased through.
    //   - ssl-flag: monomorphization of `<const SSL: bool>` is the same one
    //     used at the registration site (`Response<SSL>::on_writable`), so
    //     `cast_res::<SSL>` reaches the matching C++ template instance.
    //   - zst-thunk: `H` is asserted ZST by `thunk::zst::<H>()` — the
    //     handler has no runtime storage; constructing the function object
    //     out of thin air is sound for `Fn` impls on ZST function items
    //     and capture-less closures, which is exactly the bound on `H`.
    //   - user-data: `data` is the registrar's `user_data` pointer; null
    //     was already short-circuited above. The cast to `*mut U` matches
    //     the registrar's `U` because both monomorphizations share the
    //     `<U, H, SSL>` parameter set.
    unsafe {
        thunk::zst::<H>()(
            data.cast::<U>(),
            amount,
            thunk::handle_mut(Response::<SSL>::cast_res(this)),
        )
    }
}
```

**Hardening bead count for the crate:** 253. The expected distribution is roughly: ~120 sites that need only a one-line promotion to name the relevant dimension, ~80 trampoline-body sites that warrant the longer treatment shown above, and ~50 high-density sites (the SSL-touching paths, the `Loop::add_*_handler` raw-pointer-discipline cluster, the WebSocket message handler) that need their full structural argument written out.

---

## Cross-cutting observations

### What the inventory already classifies well
The Phase 1 inventory tags every site with a category set (e.g. `uws_ffi`, `ptr_cast`, `bun_ffi_helper`, `slice_from_raw`, `raw_ptr_lifecycle`). For the four target crates, those categories already separate the easy sites (`safe fn`-callable extern symbols) from the structurally interesting ones (lifetime-cliff slices, opaque ABI relying on `!Freeze`, trampoline bodies). The hardening pass uses the category set as the per-site triage signal: a site tagged `ptr_cast` + `uws_ffi` gets the short opaque-ABI template; a site tagged `slice_from_raw` + `uws_ffi` gets the lifetime-window template.

### Discoverability via the SAFETY prefix
The template starts every comment with `// SAFETY: <library>(<symbol>) —` so a future grep over the codebase can answer "every site that depends on libuv's `uv_run` contract" with a single regex. The current corpus uses inconsistent prefixes (some `SAFETY:`, some `Safety:`, some no prefix at all); normalizing to the templated form is itself part of the hardening pass.

### Interaction with the broader `(A) STRICTLY_UNAVOIDABLE` clusters
A-001 (the `*mut Self` callback-dispatch discipline) and A-002 (`bun_core::heap` round-trips) intersect A-003 at the trampoline-body sites: a `Response::on_writable` trampoline is *both* an A-001 callback boundary and an A-003 FFI shim. The hardened SAFETY comments must satisfy *both* clusters' obligations — the template above incorporates the A-001 "do not retain `&mut` past the body" obligation under the `this-window` bullet, and the A-002 "matching reclamation in the close-cb" obligation appears in the libuv template under `req-lifetime`.

### What A-003 explicitly does not do
- **No `unsafe`-keyword removal.** Every site stays `unsafe`.
- **No API restructuring.** The hardening pass is comment-only with the sole exception of normalizing the SAFETY-comment prefix (a tooling pass run via `bun run rust:safety-normalize` once authored).
- **No new dependencies.** No `num_enum`, no `bytemuck`, no `zerocopy`. The (C) clusters (C-001/C-002/C-003) cover those.
- **No vendoring changes.** Updates to `vendor/libuv`, `vendor/mimalloc`, etc. are out of scope; they are reviewed separately when Bun rebases the vendored snapshot.

---

## Per-PR landing checklist

For each `*_sys` crate PR:

1. Read the crate's primary file end-to-end with the library's header file open alongside (`vendor/<lib>/include/<lib>.h`).
2. For every `unsafe { … }` and `unsafe fn` in the file, classify the site against the per-crate dimension list and replace the existing SAFETY comment with the hardened-template form.
3. Where the existing comment captured a *correct insight* the template would lose, preserve it as an additional bullet — the template is a floor, not a ceiling.
4. Where the existing comment is *wrong* (e.g. claims a `&Loop` reborrow is safe to store), open a separate `pre-existing-ub-N` bead before changing the comment. Hardening must not paper over a real bug.
5. Run `cargo check -p <crate>` and `cargo doc -p <crate>` to confirm no markdown breakage in the new comments.
6. Run the Phase 9 cross-validation script (TBD; reads each `SAFETY: <lib>(<sym>)` prefix and asserts the named `<sym>` exists in the vendored header).
7. PR description names the dimensions exercised by the hardening; reviewer's job is to confirm each named dimension is documented somewhere in the upstream library's manual.

---

## Site totals across A-003

Recapping the per-crate sites in scope for the cluster:

| Crate                | Sites in PR | Notes |
|----------------------|------------:|-------|
| `bun_mimalloc_sys`   |    12 | PR 1 |
| `bun_libarchive_sys` |    45 | PR 2 |
| `bun_libuv_sys`      |   133 | PR 3 |
| `bun_uws_sys`        |   253 | PR 4 |
| `bun_libarchive`     |    81 | follow-on PR (caller-side helpers) |
| `bun_simdutf_sys`    |    50 | follow-on |
| `bun_lolhtml_sys`    |    48 | follow-on |
| `bun_cares_sys`      |    75 | follow-on |
| `bun_tcc_sys`        |    29 | follow-on |
| `bun_zlib_sys`       |    21 | follow-on |
| `bun_boringssl_sys`  |    15 | follow-on |
| `bun_brotli_sys`     |    13 | follow-on |
| Smaller `_sys` crates|   ~50 | rolled into a single follow-on PR |
| **Total in cluster** | **~825** | none refactored, all hardened |

The cluster's contribution to the audit story is the *uniform* SAFETY-comment grammar across every FFI boundary in the runtime. Once landed, "what does this `unsafe` block actually require" is a question whose answer lives at the call site, not in a header file two repositories away.
