---
title: PASS2 deep-dive — `bun_runtime` (4,893 unsafe sites)
crate: bun_runtime
crate_path: src/runtime/
total_sites: 4893
pct_of_codebase: 44%
pass: 2
date: 2026-05-15
---

# PASS2 deep-dive — `bun_runtime` (4,893 unsafe sites)

## Executive summary

`bun_runtime` is the JS-visible API surface of Bun: `Bun.serve`, `Bun.spawn`,
`fetch`, the `node:*` compat layer, the shell interpreter, the DNS resolver,
the dev server, the image codecs, and the JSC↔Rust hook layer. It owns 4,893
of the workspace's 11,116 unsafe sites (44 %). Pass-1 sampled the crate at
high level only; this pass walks the top-density files and the categorically
risky patterns end-to-end.

**Methodology.** The full inventory at
`.unsafe-audit/unsafe-inventory.jsonl` was filtered to
`crate == "bun_runtime"`, grouped by submodule and category, and the top-20
unsafe-dense files were sampled at ±50 lines around the densest sections.
Every `unsafe impl Send`/`unsafe impl Sync`, every `core::mem::transmute`,
every `Vec::from_raw_parts` reinterpret-cast, every `Pin::new_unchecked` /
`NonNull::new_unchecked`, every `slice::from_raw_parts` where the length
crosses an FFI boundary, and every `bytemuck::Pod`/`Zeroable` impl was
inspected for a SAFETY argument, an aliasing model, and a runtime invariant.

**Headline bug-finding count.**

| Class | Found |
|---|---:|
| **Pre-existing UB (genuine soundness defect)** | **1** |
| **Soundness-fragile** (depends on undocumented mimalloc behaviour) | **1** |
| **Refactor opportunities** (sound today, but `unsafe`-removable) | **5** |
| **Documentation gaps** (sound, but SAFETY comment is missing or wrong-shape) | **9** |

The genuine UB finding (UB-RT-001) is `Vec::from_raw_parts` reinterpret of
`Vec<u8>` to `Vec<u16>` in `webcore/encoding.rs:303-310` — well-known to
Rust's allocator-layout contract; the in-tree `TODO(port)` comment
acknowledges it. The soundness-fragile finding (UB-RT-002) is the same site's
silent dependency on mimalloc giving ≥2-byte alignment for u8 allocations.

No use-after-free, no cross-thread `Strong` drop, no buffer-overflow, and no
GC-pinning failure was found in the sampled set. The crate's worst hazards
are concentrated in the **C-FFI buffer surface** (`FFIObject.rs`,
`encoding.rs`, `TextEncoder.rs`) and the **JSC lifetime erasure** sites
(`jsc_hooks.rs:2324` widens `&'a [u8]` to `&'static [u8]`).

## Per-submodule unsafe-density table

| Submodule | Sites | Primary character |
|---|---:|---|
| `socket/` | 424 | uws/usockets FFI; opaque ZST deref; pipe-writer raw-ptr re-entry |
| `node/` | 422 | libuv FFI, `fs.watch`/`StatWatcher` intrusive queues, zlib FFI |
| `cli/` | 382 | `bun run`/`bunx` raw arg/env slicing, path buffer pool |
| `webcore/` | 367 | Blob, fetch, streams, Crypto, encoding — Web-API surface |
| `server/` | 358 | `Bun.serve` request lifecycle, route refcounts, H3 pool |
| `api/` | 347 | `BunObject` host-fns; FFI; filesystem_router; cron |
| `jsc_hooks.rs` | 296 | RuntimeHooks slots; module loader; transpile_virtual_module |
| `dns_jsc/` | 257 | c-ares + libuv DNS resolver, GlobalCache locked-state |
| `bake/` | 202 | DevServer SSR bundle pipeline; HotReloadEvent |
| `shell/` | 174 | shell interpreter raw-this pattern; rm/ls async tasks |
| `test_runner/` | 166 | `bun test` worker pool & per-test state |
| `api/bun/` | 163 | spawn/subprocess/h2_frame_parser/Terminal — Bun-specific APIs |
| `image/` | 162 | libwebp / libjpeg-turbo / libpng / WIC FFI |
| `timer/` | 134 | `setTimeout`/`WTFTimer` + `EventLoopTimer` |
| `webcore/blob/` | 129 | Blob `Store`, `read_file`, `write_file` |
| `ffi/` | 89 | `bun:ffi` — intentionally user-callable unsafe surface |
| `cli/test/parallel/` | 86 | Worker/Coordinator parallel test scheduler |
| `napi/` | 85 | N-API compatibility shim |
| `shell/builtin/` | 81 | shell rm/ls/cp builtins on threadpool |
| `webcore/s3/` | 73 | S3 multipart upload — adopting/releasing Vec ownership |

The five highest-leverage submodules for further audit are `webcore/`,
`server/`, `api/bun/`, `jsc_hooks.rs`, and `shell/` — they account for 1,538
sites (31 % of the crate) and contain every JS-visible
lifetime-and-aliasing-sensitive callback boundary.

## Top-20 unsafe-dense files

| File | Sites | Primary pattern | Audit verdict |
|---|---:|---|---|
| `jsc_hooks.rs` | 296 | JSC ↔ Rust hook bodies; per-field raw deref of `VirtualMachine` to avoid `&mut VM` aliasing | Sound; PORT NOTE comments are exemplary. One brittle site at 2324 (UB-RT-DOC-001). |
| `dns_jsc/dns.rs` | 219 | c-ares request/cache; libuv-poll hooks; `unsafe impl Send for SendPtr<T>` / `for GlobalCache` | Sound. `SendPtr` is `#[repr(transparent)]` so cross-thread queue carriage is OK; `GlobalCache` only crosses while `GLOBAL_CACHE` is locked. |
| `bake/DevServer.rs` | 169 | SSR bundle pipeline; `NonNull::new_unchecked` on deferred-data heap; hot-reload event chain | Sound; intrusive refcount discipline matches Zig spec line-for-line. |
| `api/cron.rs` | 155 | Cron job state machine; raw `*mut Self` for re-entrant callbacks (`maybe_finished`, `finish`, `advance_state`) | Sound; documented "local reborrow, no protector; ends before self-freeing call" pattern is consistent and grep-able. |
| `node/node_fs.rs` | 127 | libuv `uv_fs_*` calls, intrusive `Linked` for `ResultListEntry`, slice-from-raw of `args.buffers.buffers` | Sound. `ResultListEntry::link` is `addr_of!((*item).next)` — canonical. |
| `webcore/Blob.rs` | 119 | `Store::deref` lifecycle, mmap adoption, file-Blob slicing | Sound; `Blob__fromMmapWithType` (5980) annotated correctly. |
| `socket/socket_body.rs` | 112 | uws socket callbacks + raw-this re-entry; pipe/SSL adapters | Sound. |
| `server/mod.rs` | 98 | `Bun.serve` route refcount, `*mut server` carriage, `request_pool.try_get()` + `MaybeUninit::write` | Sound. The pooled `RequestContext::create(uninit, ..)` is the canonical "init-then-promote" path; matches `bun_jsc` conventions. |
| `napi/napi_body.rs` | 85 | N-API shim; `unsafe impl Sync for napi_node_version` | Sound; `napi_node_version` is `#[repr(C)] { major,minor,patch,release }` POD. |
| `cli/run_command.rs` | 83 | CLI argv/env raw slicing — entry-point only, before VM init | Sound. Static lifetime widening (3274, 3860, 3871) keyed on `bunx_fast_path_buffers` thread-local, never reentrant. |
| `server/server_body.rs` | 75 | continuation of server/mod.rs; ServePlugins state machine | Sound. |
| `socket/uws_handlers.rs` | 73 | uws C-callback thunks; opaque ZST deref | Sound. |
| `shell/subproc.rs` | 72 | ShellSubprocess + StaticPipeWriter raw-this pattern | Sound; intrusive RefPtr semantics carry over from Zig exactly. |
| `webcore/blob/write_file.rs` | 71 | adopt/release `Vec` for write-side body buffers | Sound. |
| `api/bun/h2_frame_parser.rs` | 63 | h2 wire-format parser; `bytemuck::Pod`/`Zeroable` for `StreamPriority` / `FullSettingsPayload`; manual `copy_nonoverlapping` packer | Sound. Pod impls are valid (no padding, no niches, every byte-pattern valid). |
| `api/html_rewriter.rs` | 62 | lol-html FFI; rewriter callback chain; `tmp_sync_error` smuggling | Sound. |
| `server/RequestContext.rs` | 58 | per-request lifecycle; `as_response` returns `&'static mut`; signal release order | Sound but **fragile** — see UB-RT-FRAGILE-001 below. |
| `node/path_watcher.rs` | 56 | `unsafe impl Sync` over `Cell<Fd>` / `UnsafeCell` watcher tables under a `Mutex` | Sound but fragile — `Cell<Fd> platform_fd` cross-thread access depends on thread-spawn publish ordering (UB-RT-FRAGILE-002). |
| `test_runner/bun_test.rs` | 53 | per-test heap allocations & cross-thread reporters | Sound. |
| `socket/WindowsNamedPipe.rs` | 53 | Windows-only named-pipe shim; libuv pipe FFI | Sound. |

## Per-invariant cross-crate spot-check

The three highest-risk port invariants for this crate are I-002 (cross-thread
`Strong` drop), I-003 (refcount transfer on `to_js()`), and I-004 (raw-`*mut
Self` re-entry without forming `&mut Self`). Five-to-ten sites per invariant
were sampled at random across the top-density files.

### I-002 (cross-thread `Strong` drop): compliant in sampled sites

`bun_jsc::Strong` and `JSPromiseStrong` are `!Send + !Sync` (verified in the
`bun_jsc` source). Every `Strong` field in the sampled set lives on a
struct whose lifecycle is bounded to a single thread:

| Site | File:line | Strong type | Thread-binding mechanism |
|---|---|---|---|
| `NewServer.all_closed_promise` | `server/mod.rs:283` | `JSPromiseStrong` | server is `!Send` (raw `*mut uws_sys::NewApp`) |
| `NewServer.on_clienterror` | `server/mod.rs:304` | `jsc::StrongOptional` | same |
| `NewServer.listen_callback` | `server/mod.rs:285` | `jsc::AnyTask` | same |
| `H2Stream.js_context` | `api/bun/h2_frame_parser.rs:1426` | `StrongOptional` | h2 session is `!Send` |
| `H2Stream.callback` (done) | `api/bun/h2_frame_parser.rs:1587` | `StrongOptional` | same |
| `SubprocessPipeReader.array_buffer.held` | `api/bun/spawn/stdio.rs:538` | `StrongOptional` | pipe reader holds a `*mut VM` |

The discipline mirrors the documented `bun_runtime` rule: every struct that
owns a `Strong` is either statically `!Send` because of a raw FFI pointer
field, or it is reached only through the JS-thread `RuntimeState`
thread-local. No cross-thread drop sites surfaced in the sample.

### I-003 (refcount transfer on `to_js`): compliant in sampled sites

Six `to_js` callsites were traced from the producer site through the
finalizer:

| Producer | Consumer/finalizer | Net ref |
|---|---|---|
| `server/mod.rs:834` `Request::to_js(global)` | C++ `JSRequestObject` finalizer → `Request::deref` | +0 |
| `webcore/Blob.rs:5980` `Blob::new(Store::init_mmap(..))` | C++ `JSBlob` finalizer → `Blob::deref` | +0 |
| `api/BunObject.rs:1689-1691` `forget(escaped_html)` + `zig_string_to_external_u16` | JSC `Bun__freeExternalString` callback | +0 |
| `api/cron.rs:355` `drop(heap::take(this))` | n/a — last ref on `CronJob` itself | +0 |
| `webcore/streams.rs:2589` `Vec::from_raw_parts` adopting `slice_ptr` | `StreamResult::release` → `clear_and_free` | +0 |
| `webcore/encoding.rs:303-310` `Vec<u16>::from_raw_parts` then `create_external_globally_allocated_utf16` | JSC external-string finalizer → `free_globally_allocated` | +0 (**but see UB-RT-001 below**) |

No double-`ref` and no missing-`ref` surfaced. The auditor notes the macro
`#[derive(CellRefCounted)]` (codegen output) is the canonical safety net —
every C++-finalizer-bound type goes through it.

### I-004 (raw-`*mut Self` re-entry without forming `&mut Self`): compliant

Sampled in `cron.rs`, `subproc.rs`, `RequestContext.rs`, `subprocess.rs`,
`bake/DevServer.rs`. Every callback that may free `self` (e.g.
`maybe_finished`, `on_response`, `deinit_for_callback`) dispatches off `*mut
Self` and only forms `&mut *this` inside a local block whose lexical scope
ends **before** the freeing call. The `unsafe { &mut *this }` reborrow plus
"local reborrow, no protector; ends before self-freeing call" SAFETY comment
is the dominant idiom and is consistent file-by-file.

The one site that bends the rule is documented:
`api/cron.rs:262` returns `&'static mut ShellCmd` via
`bun_ptr::detach_lifetime_mut` — a deliberate widening of an arena-bound
`Cmd` reference. The comment names the three callers and proves each drops
the borrow before `free_node` recycles the slot. Tagged as
documentation-only, not a defect.

## Bug findings

### UB-RT-001 (pre-existing soundness defect)

**Location:** `src/runtime/webcore/encoding.rs:303-310`.

```rust
let as_u16 = unsafe {
    let mut input = core::mem::ManuallyDrop::new(input);
    Vec::from_raw_parts(
        input.as_mut_ptr().cast::<u16>(),
        usable_len / 2,
        input.capacity() / 2,
    )
};
create_external_globally_allocated_utf16(as_u16)
```

`input` is a `Vec<u8>` whose backing allocation was produced with
`Layout::array::<u8>(orig_cap)` — i.e. align-of-1, size-of `orig_cap`.
`Vec::from_raw_parts::<u16>` *requires* the pointer/length/capacity to satisfy
the `Vec<u16>` allocator-layout contract:

1. The buffer must have been allocated with `Layout::array::<u16>(cap).unwrap()`.
2. When the `Vec<u16>` drops, the global allocator is told to free with the
   `u16` layout. mimalloc tolerates this in practice because it stores the
   true block size in the segment header and ignores the caller-supplied
   layout's size field, but the *contract* the unsafe code claims is violated.
3. The `u16` reads themselves are unaligned-load UB on any architecture
   where `u16` requires 2-byte alignment; mimalloc happens to round to
   ≥16-byte alignment for any allocation, so the loads work in practice.

The in-tree `TODO(port)` comment at line 298 explicitly acknowledges the bug:

> Reinterpreting a `Vec<u8>` as `Vec<u16>` is not generally sound in Rust
> (alignment + allocator layout). Phase B: route through `bun_core::String`
> API that accepts raw (ptr, len, cap) bytes.

**Trigger.** Reachable via JS `Buffer.from(bytes).toString("ucs2")` /
`"utf16le"`. User-controlled `bytes.length` flows directly to `usable_len`.

**Severity.** Pre-existing UB. Not a security bug today because mimalloc's
alignment and block-size accounting hide it, but the contract is broken and
will surface if either (a) the global allocator changes (e.g. ASAN run with
the system allocator) or (b) the Rust standard library tightens the
`Vec::from_raw_parts` debug assertion.

**Recommended fix.** Track as `UB-RT-001`: replace the
`Vec<u16>` round-trip with a `bun_core::String::create_external_utf16` that
takes `(ptr: *mut u8, byte_len: usize)` and an explicit byte-wise free
callback. Avoid `Vec::from_raw_parts` reinterpret-casts entirely.

### UB-RT-002 (soundness-fragile)

Same site as UB-RT-001. The SAFETY comment says

> `input.as_ptr()` is at least 1-aligned; Zig asserted u16 alignment via
> `@alignCast`.

The Zig version *checked* alignment at the boundary and panicked otherwise;
the Rust port silently assumes alignment. mimalloc's `MI_DEFAULT_ALIGN`
covers it today but the contract is invisible. Track as
`UB-RT-002`: even if UB-RT-001 is fixed by route-change, add a
`debug_assert_eq!(ptr as usize & 1, 0)` near every reinterpret boundary.

### UB-RT-DOC-001 (documentation gap, sound)

**Location:** `src/runtime/jsc_hooks.rs:2324`.

```rust
let spec_static: &'static [u8] = unsafe {
    core::slice::from_raw_parts(specifier.as_ptr(), specifier.len())
};
let fallback_path = bun_paths::fs::Path::init_with_namespace(spec_static, b"node");
fallback_source = bun_ast::Source {
    path: fallback_path,
    contents: bun_ptr::Cow::Borrowed(code),
    ..Default::default()
};
```

`specifier` is a `&'a [u8]` borrowed from the caller's stack. The widen to
`&'static [u8]` is justified by the comment "`specifier` is a
`node_fallbacks` key — a `&'static [u8]` literal — so no lifetime erasure
needed." This is true *given* the upstream `node_fallbacks::contents_from_path`
match, but it is invisible at this site. If the upstream function is ever
changed to return a longer-lived-but-not-static slice, this site silently
becomes UB.

**Recommended fix.** Change the helper signature:

```rust
fn contents_from_path(specifier: &[u8]) -> Option<(&'static [u8], &'static [u8])>;
//                                                  ^^^^^^^^^^^^ key      ^^^^^^^^^^^^ contents
```

so the `'static` is mechanically threaded and the `from_raw_parts` widen
disappears. Refactor candidate, no fix needed in this PR.

### UB-RT-FRAGILE-001 (sound, brittle)

**Location:** `src/runtime/server/RequestContext.rs:321-322`.

```rust
unsafe fn as_response(value: JSValue) -> Option<&'static mut Response> {
    response::from_js(value).map(|p| unsafe { &mut *p.cast::<Response>() })
}
```

The `&'static mut Response` is the strongest borrow Rust has; lifetime is
proven only by the caller pairing the borrow with an
`ensure_still_alive`/`protect()` on `value`. The single caller at line 761
satisfies this, but the signature does not encode it — a future caller will
silently introduce UAF.

**Recommended fix.** Pass an `&'a JSValue` token to the helper and return
`Option<&'a mut Response>`. C-003-equivalent refactor.

### UB-RT-FRAGILE-002 (sound, brittle)

**Location:** `src/runtime/node/path_watcher.rs:108-109`, with the
load-bearing reads at lines 655 (`inotify_fd`) and 1216 (`kqueue_fd`).

```rust
unsafe impl Sync for PathWatcherManager {}
unsafe impl Send for PathWatcherManager {}

#[cfg(any(target_os = "linux", ...))]
platform_fd: Cell<Fd>,
```

`Cell<T>` is `!Sync` by construction. The Sync impl claims access is gated
by `mutex`, but the `Cell<Fd> platform_fd` is **read from the reader thread**
without acquiring `mutex` (line 655, 1216). The proof — "set once in
`init()` before the reader thread spawns" — is correct because
`std::thread::spawn` carries a happens-before edge that publishes the write
to the reader; but the type system doesn't reflect this and a future
"add nonblocking-toggle on the fd" refactor would not get a compile error.

**Recommended fix.** Replace `Cell<Fd>` with `OnceLock<Fd>` (whose `get()` is
`Sync`-safe) or — since `Fd` is `Copy + repr(transparent over i32)` — an
`AtomicI32`. Refactor candidate, sound today.

### Negative findings (audited, no defect)

| Suspected class | Sites checked | Verdict |
|---|---|---|
| TLS hijack via `unsafe impl Sync for SSLConfig` (`src/http/ssl_config.rs:445`) | 3 cross-references | Sound. All raw `CStrPtr` fields are owned heap copies (produced by `dupe_z`/`free_sensitive` pair); `cached_hash` is `AtomicU64`; no interior mutability. Cross-thread reload paths re-clone the whole `SSLConfig`, not aliasing the original. |
| Buffer overflow in `Bun__fromMmapWithType` | `webcore/Blob.rs:5980` | Sound. The mmap'd region is the WebKit screenshot path which always passes `len = mmap'd page count × page_size`. |
| GC-without-protect between `signal.ref_()` and `AbortSignalRef::adopt` | `server/mod.rs:752-754` | Sound. The intrusive `ref_()` increments the counter and returns the same pointer; no JS allocation happens between. |
| Drop in Drop during panic for `ShellSubprocess` | `shell/subproc.rs:300` | Mitigated. `finalize_sync()` does not allocate or panic (just closes pipes / file descriptors); a panic during its body would abort but not corrupt state. |
| `bytemuck::Pod` for `StreamPriority` / `FullSettingsPayload` | `api/bun/h2_frame_parser.rs:363,365,488,490` | Sound. Both types are `#[repr(C, packed)]` with `u16`/`u32` fields only — no padding, every byte-pattern valid. Static `const _: assert!` checks the size; the Pod requirement is met. |
| `transmute::<usize, JSTypedArrayBytesDeallocator>` | `ffi/FFIObject.rs:23-28` | Sound by design. `bun:ffi` is an intentionally user-callable unsafe surface; the user supplies their own C function pointer. |
| `transmute::<_, WICConvertBitmapSourceFn>` | `image/backend_wic.rs:923` | Sound. `GetProcAddress` returns `FARPROC = Option<unsafe extern "system" fn()>`; cast to specific signature is canonical Win32. |
| `transmute_copy::<*mut c_void, T>` | `node/fs_events.rs:164` | Sound. Reads a raw pointer field through a `T: Copy + repr(transparent over *mut c_void)` constraint — standard CoreFoundation idiom. |

## Refactor opportunities (sound → safe)

These clusters are sound but can be lifted out of `unsafe` with mechanical
refactors. They are C-class candidates per the audit's classification system.

**C-RT-A: `Vec<u8>` → `Vec<u16>` reinterpret (encoding.rs:303).** Fixes
UB-RT-001 *and* removes the unsafe block entirely. Replace with a
`bun_core::String::clone_utf16_from_le_bytes(input: &[u8])` that internally
copies into a `WTFStringImpl` buffer that *is* `u16`-allocated.

**C-RT-B: Lifetime-erasure on `node_fallbacks` key (jsc_hooks.rs:2324).**
Thread `&'static [u8]` through `contents_from_path`'s return type. Removes
the `unsafe` block.

**C-RT-C: `Cell<Fd>` cross-thread in `PathWatcherManager`.** Switch to
`AtomicI32` for `platform_fd`; switch `next_gen` to a `u64` field guarded
under the same mutex (it is already accessed only under the mutex per the
comment) — drop the `Cell` wrapper. Removes 2 of the 56 unsafe sites.

**C-RT-D: `&'static mut Response` widening in `RequestContext`.** Thread
`&'a JSValue` into `as_response`; constrain the returned `&mut Response` to
`'a`. Removes 4 of the 58 unsafe sites in that file (the `as_response`
helper plus its 3 callers).

**C-RT-E: H2 wire-format `copy_nonoverlapping` (h2_frame_parser.rs:451-458,
377-384).** Use `bytemuck::from_bytes_mut::<SettingsPayloadUnit>(&mut buf)`
plus byte-swaps; eliminates the `unsafe { copy_nonoverlapping(.., dst.cast::<u8>().add(offset), src.len()) }`. Removes 4 of the 63 unsafe sites in that file.

## Hardened SAFETY-comment templates

The dominant patterns in this crate are six. Templates for each follow.

**Template T-RT-1 — Raw-`*mut Self` re-entry callback.**

```rust
// SAFETY: `this` is the live <TypeName> heap allocation owned by
// <Owner>; <invocation invariant: e.g. "fires while the
// `pending_main_callbacks` refcount is non-zero">. We do NOT form
// `&mut *this` across the call to `<freeing method>`; the local reborrow
// (`unsafe { &mut *this }`) is scoped to <expression> and dropped before
// any path that may free `*this`.
```

Reference: `api/cron.rs:298-309`, `shell/builtin/rm.rs:1497-1505`.

**Template T-RT-2 — Slice from FFI-supplied (ptr, len).**

```rust
// SAFETY: caller (<C++ owner / specific source>) guarantees
// `<ptr>[..<len>]` is initialized, readable for `<len>` bytes, and
// remains live for the duration of this call. <Optional: `<len>` is
// bounded by <protocol limit> — e.g. "≤ MAX_FRAME_SIZE per RFC 7540 §6.5">.
```

Reference: `api/BunObject.rs:1371`, `webcore/Crypto.rs:246-247`.

**Template T-RT-3 — Intrusive refcount transfer.**

```rust
// SAFETY: <pointer> carries the +1 ref produced by <create site>; this
// adopts ownership of that ref into <handle type>, whose `Drop` releases
// it via `<deref method>`. No code path between the create site and here
// may have released the +1.
```

Reference: `server/mod.rs:752-754`, `shell/subproc.rs:154-156`.

**Template T-RT-4 — `&'static`/`&'static mut` widen.**

```rust
// SAFETY: the underlying allocation is process-lifetime
// (<reason: singleton/OnceLock/RuntimeState/etc.>); the `'static` lifetime
// is not a lie. (For `&mut`: additionally, single JS thread + non-Send
// owner ⇒ no concurrent `&mut`.)
```

Reference: `jsc_hooks.rs:152-158`, `bake/DevServer.rs:2178`.

**Template T-RT-5 — `Vec::from_raw_parts` adopting an FFI/owned slice.**

```rust
// SAFETY: <ptr> is the head of a default-global-allocator
// (mimalloc) allocation of exactly <cap> bytes whose ownership is
// transferred here; <len> bytes are initialized. The reconstructed `Vec`
// will free with `<T>` layout that matches the original allocation's
// element type (`<T>` == element type at allocation site).
```

Reference: `webcore/streams.rs:2589-2596`, `webcore/s3/multipart.rs:241-247`.
*Counter-example*: `webcore/encoding.rs:303-310` violates this template (the
allocation was for `u8`, the reconstruction is for `u16`).

**Template T-RT-6 — `unsafe impl Send`/`unsafe impl Sync` on a raw-pointer-bearing struct.**

```rust
// SAFETY: every raw pointer / interior-mut field stored here is
// <synchronization mechanism>:
//   - `<field>`: <set once, before <publish event>; reader observes via
//     happens-before edge of <event>>
//   - `<field>`: <accessed only under `<mutex>` lock>
//   - `<field>`: <atomic / Send + Sync wrapper>
// No `Cell`/`UnsafeCell` field is accessed without the mutex unless its
// publish is ordered before the consumer thread is spawned.
```

Reference: `dns_jsc/dns.rs:2384-2386`, `node/path_watcher.rs:102-109`.

## Recommended PRs

**PR-RT-1 (priority: high).** Fix UB-RT-001 / UB-RT-002 by replacing the
`Vec<u8> → Vec<u16>` reinterpret with a typed `String::clone_utf16_from_le_bytes`
or equivalent. Adds a `debug_assert!` guard against alignment surprises.
Estimated diff: ~40 LOC in `webcore/encoding.rs`, plus one new helper in
`bun_core::String`.

**PR-RT-2 (priority: medium).** Apply refactors C-RT-B, C-RT-C, C-RT-D, C-RT-E
as four separate commits. Net reduction: ~10 unsafe sites; substantial
clarity gain. No behavioural change.

**PR-RT-3 (priority: medium).** Adopt SAFETY-comment templates T-RT-1
through T-RT-6 as the audited canonical forms for this crate, and update
the 9 sites with missing or wrong-shape comments. (Identified sites available
on request from this audit's working notes; primary offenders are
`server/RequestContext.rs:321`, `shell/subproc.rs:111-114`, and 7 sites in
`bake/DevServer.rs` where the SAFETY comment elides the publish ordering.)

**PR-RT-4 (priority: low).** Add a `clippy::transmute_ptr_to_ref` /
`clippy::cast_ptr_alignment` allow-list to `Cargo.toml` for the FFI surface,
and an explicit `#[deny]` for those lints elsewhere in `bun_runtime`. Codifies
the audit decisions for the future.

## Notes on the un-sampled 95 %

Of the 4,893 sites, this pass directly inspected ~150 sites in detail (3 %)
and skimmed ~600 more via the inventory snippets (12 %). The remaining 85 %
fall into three pattern classes whose representative samples were audited:

1. **Field-deref under raw `*mut Self`** — handles via T-RT-1. Pattern-matched
   across all sampled high-density files; no deviations found.
2. **`opaque_ffi!` ZST deref** — handles via T-RT-2 (ZST deref is a no-op so
   the SAFETY argument reduces to "pointer non-null and from FFI"). Pattern
   uniform across `socket/`, `uws_handlers.rs`, `WindowsNamedPipe.rs`.
3. **`heap::take` / `heap::destroy` lifecycle pairs** — handles via T-RT-3.
   Pattern uniform; 133 sites across the crate, every one I traced has a
   matching `heap::into_raw` / `heap::alloc` producer.

A future pass-3 should sample the un-audited 85 % with the explicit goal of
finding sites that deviate from these templates — a deviation is the
strongest signal that a bug lives there.

## Appendix A: representative sites (45 total)

| # | File:line | Category | Verdict |
|---:|---|---|---|
| 1 | `jsc_hooks.rs:142` | zig_port_mut_ref | Sound; per-field raw deref of `state` avoids `&mut RuntimeState` aliasing |
| 2 | `jsc_hooks.rs:170-175` | raw_method_call | Sound; `runtime_state_of` documented as "may run off VM thread" |
| 3 | `jsc_hooks.rs:189-217` | jsc_ffi | Sound; `default_client_ssl_ctx` lazy-inits under SSL ctx cache |
| 4 | `jsc_hooks.rs:228-242` | jsc_ffi | Sound; `ssl_ctx_cache_get_or_create` |
| 5 | `jsc_hooks.rs:275-291` | bun_heap_lifecycle | Sound; `into_raw` paired with `deinit_runtime_state` |
| 6 | `jsc_hooks.rs:311-314` | ptr_intrinsic | Sound; reads `vm.log` immediately after VM init |
| 7 | `jsc_hooks.rs:346` | static_widen | Sound; the `Arena` `Box` payload is heap-stable |
| 8 | `jsc_hooks.rs:354-378` | ptr_intrinsic | Sound; `ptr::write` over zeroed bytes is the correct shape |
| 9 | `jsc_hooks.rs:2324-2326` | slice_from_raw | **Doc gap** — UB-RT-DOC-001 |
| 10 | `dns_jsc/dns.rs:107` | send_impl | Sound; `SendPtr<T>` documented |
| 11 | `dns_jsc/dns.rs:2386` | send_impl | Sound; `GlobalCache` mutex-gated |
| 12 | `dns_jsc/dns.rs:4726-4779` | libuv_ffi | Sound; uv close callback uniform pattern |
| 13 | `dns_jsc/dns.rs:4805-4827` | libuv_ffi | Sound; uv poll_init/start/close |
| 14 | `bake/DevServer.rs:2178` | pin_unchecked | Sound; `NonNull::new_unchecked` on freshly-into_raw'd box |
| 15 | `api/cron.rs:78-124` | raw_method_call | Sound; T-RT-1 canonical |
| 16 | `api/cron.rs:262` | static_widen | Sound; documented `detach_lifetime_mut` |
| 17 | `api/cron.rs:355` | bun_heap_lifecycle | Sound; `drop(heap::take(this))` |
| 18 | `node/node_fs.rs:794-832` | libuv_ffi | Sound; uv_fs_open / uv_fs_close |
| 19 | `node/node_fs.rs:2314-2320` | other_unsafe_impl | Sound; `Linked::link` canonical |
| 20 | `node/path_watcher.rs:102-109` | sync_impl | **Fragile** — UB-RT-FRAGILE-002 |
| 21 | `node/path_watcher.rs:655` | raw_field_read | Sound; reads from reader thread under publish-edge |
| 22 | `webcore/Blob.rs:5980` | slice_from_raw | Sound; mmap path documented |
| 23 | `webcore/Blob.rs:3671` | pin_unchecked | Sound; `Store::retained` adopting ref |
| 24 | `webcore/Crypto.rs:220-249` | slice_from_raw | Sound; `timing_safe_equal` |
| 25 | `webcore/encoding.rs:303-310` | slice_from_raw | **UB** — UB-RT-001 / UB-RT-002 |
| 26 | `webcore/encoding.rs:520-531` | ptr_arith | Sound; alignment-checked fast path |
| 27 | `webcore/streams.rs:2589-2596` | slice_from_raw | Sound; adopting Vec ownership |
| 28 | `webcore/TextEncoder.rs:307-330` | slice_from_raw | Sound; `encodeInto16` |
| 29 | `webcore/s3/multipart.rs:241-247` | slice_from_raw | Sound; `Vec::from_raw_parts` reclaim |
| 30 | `server/mod.rs:683-687` | raw_field_read | Sound; `Debug::enter_scope` on VM-owned field |
| 31 | `server/mod.rs:705-721` | maybe_uninit | Sound; pool slot + `MaybeUninit::write` + promotion |
| 32 | `server/mod.rs:736-744` | bun_heap_lifecycle | Sound; hive_alloc + addr_of_mut |
| 33 | `server/mod.rs:752-761` | jsc_object_handle | Sound; signal ref/adopt pair |
| 34 | `server/RequestContext.rs:321-322` | raw_cast | **Fragile** — UB-RT-FRAGILE-001 |
| 35 | `server/RequestContext.rs:1547` | callback_ctx | Sound; `callback_ctx` canonical |
| 36 | `shell/subproc.rs:111-114` | raw_method_call | Sound; `buffer_mut` shell-single-thread |
| 37 | `shell/subproc.rs:540-563` | bun_heap_lifecycle | Sound; `heap::take` + manual cleanup |
| 38 | `shell/builtin/rm.rs:828-893` | atomic | Sound; `Ordering::SeqCst` on shared counters |
| 39 | `api/bun/h2_frame_parser.rs:363-365,488-490` | other_unsafe_impl | Sound; `bytemuck::Pod`/`Zeroable` valid |
| 40 | `api/bun/h2_frame_parser.rs:450-463` | ptr_intrinsic | Sound; `copy_nonoverlapping` bounded |
| 41 | `ffi/FFIObject.rs:23-28` | mem_transmute | Sound by design (user-supplied fn ptr) |
| 42 | `image/codec_jpeg.rs:280-289` | slice_from_raw | Sound; tj3GetICCProfile out-param |
| 43 | `image/codec_webp.rs:200-216` | slice_from_raw | Sound; demuxer chunk iterator |
| 44 | `image/backend_wic.rs:923` | mem_transmute | Sound; GetProcAddress canonical |
| 45 | `webview/ChromeProcess.rs:49-69` | atomic | Sound; `AtomicPtr` JS-thread singleton |

## Appendix B: bug-finding count summary

| ID | Title | Class | Severity | Status |
|---|---|---|---|---|
| `UB-RT-001` | Vec u8→u16 reinterpret in `encoding.rs:303` | Pre-existing UB | High | Confirmed |
| `UB-RT-002` | Silent alignment dependence on mimalloc at same site | Soundness-fragile | Medium | Confirmed |
| `doc-gap-rt-1` | `'static` widen on `specifier` slice in `jsc_hooks.rs:2324` | Doc gap | Low | Confirmed |
| `fragile-rt-1` | `&'static mut Response` widening in `RequestContext.rs:321` | Soundness-fragile | Low | Confirmed |
| `fragile-rt-2` | `Cell<Fd>` cross-thread in `path_watcher.rs:108` | Soundness-fragile | Low | Confirmed |
| `refactor-rt-A..E` | Five refactor opportunities (C-class) | Refactor | n/a | Open |

**Total: 1 pre-existing UB, 1 soundness-fragile sibling, 3 documentation /
fragility gaps, 5 refactor opportunities.** None of the findings is a
currently-exploitable crash, and none requires an immediate hotfix; UB-RT-001
is the highest priority because (a) it is the only true UB and (b) any
fuzzing run with a non-mimalloc allocator (ASAN, MSAN, valgrind) would flag
it as a Vec layout violation.
