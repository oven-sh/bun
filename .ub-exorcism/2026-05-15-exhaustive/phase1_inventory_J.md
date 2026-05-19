# Phase-1 Inventory — Section J: runtime-misc

Run: `2026-05-15-exhaustive` · Sub-agent: unsafe-surface-mapper-J · Section paths (10):
`src/runtime/test_runner/`, `src/runtime/image/`, `src/runtime/timer/`,
`src/runtime/ffi/`, `src/runtime/napi/`, `src/runtime/valkey_jsc/`,
`src/runtime/crypto/`, `src/runtime/webview/`, `src/runtime/allocators/`,
`src/runtime/webcore.rs` (single file at runtime root).

## Totals

| metric | test_runner | image | timer | ffi | napi | valkey_jsc | crypto | webview | allocators | webcore.rs | TOTAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `unsafe {` blocks | 209 | 166 | 131 | 88 | 83 | 36 | 37 | 19 | 10 | 3 | **782** |
| `unsafe fn` decls | 8 | 0 | 18 | 4 | 6 | 4 | 0 | 0 | 5 | 0 | **45** |
| `unsafe impl` | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | **3** |
| `unsafe extern` blocks | 11 | 41 | 4 | 27 | 29 | 0 | 0 | 2 | 0 | 1 | **115** |
| `// SAFETY:` lines | 232 | 148 | 129 | 91 | 78 | 34 | 41 | 21 | 9 | 4 | **787** |
| `extern "C"` / `no_mangle` | 31 | 16 | 25 | 49 | 156 | 2 | 10 | 12 | 0 | n/a | **301** |
| transmute / set_len / assume_init / get_unchecked / UnsafeCell / mem::forget / mem::zeroed / `hint::*_unchecked` | 35 | 7 | 5 | 4 | 0 | 1 | 3 | 0 | 0 | n/a | **55** |
| `unsafe impl Send`/`Sync` | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | **1** |

**Surface site count (blocks + unsafe fn + unsafe extern items): 942** vs prior **789** (+153, ≈ +19 %).
Growth is driven mostly by ongoing Zig→Rust ports landed since the prior audit
(image codecs +37, napi handle-scope/tsfn port +20, timer scheduler raw-ptr
discipline rewrite +30, test_runner `expect`/`Execution` +30) and by the fact
that each `bun_jsc::host_fn` / `bun_jsc::jsc_host_abi!` macro expansion now
counts as one `unsafe fn` shim in the file where invoked.

Safety-comment coverage: 787 / 942 ≈ **84 %**. Per-path quality is uneven —
strong in crypto (110 % — multiple SAFETY lines per block), test_runner (≈ 100 %),
timer (≈ 79 %), valkey_jsc (≈ 87 %), allocators (≈ 80 %), webcore.rs (≈ 100 %);
weaker in napi (≈ 70 %), image (≈ 72 %), webview (≈ 100 %) — image's lower
coverage is because COM-pointer round-trips through `windows::IUnknown::Release`
share one upstream SAFETY block.

## Per-row table (one row per file or cluster of unsafe surface)

| file | kind | site_count | dominant_bucket | macro_generated | safety_quality | notes |
|---|---|---:|---|---|---|---|
| `src/runtime/test_runner/bun_test.rs` | BunTestPtr / BunTestCell shared/exclusive borrow gate | 57 | 1 Aliasing (UnsafeCell wrapper) | source-direct + `bun_jsc::host_fn!` | PRESENT_STRONG | `BunTestCell` is the canonical R-2 "thread-local UnsafeCell with caller-discipline" wrapper. `buntest_as_mut` is an `unsafe fn` with documented `# Safety` after a UAF fix that removed a `*const T as *mut T` cast (lines 419-432). `LinearFifo<RefDataValue, _>` declared at line 1503 — **EXP-001 hot caller** (see cross-refs). |
| `src/runtime/test_runner/expect.rs` | matcher / mock plumbing, `__apply_custom_matcher_shim` | 35 | 1 Aliasing-callback, 21 FFI re-entry | `bun_jsc::jsc_host_abi!` (1 invocation, ~5 shim arms); `bun_jsc::host_fn!` (~12 callers) | PRESENT_STRONG | Several local `unsafe extern "C"` declarations for `JSMockFunction__*` / `Bun__JSWrappingFunction__create` carry contracts. |
| `src/runtime/test_runner/Execution.rs` | arena-allocated test sequence/group cursor walker | 29 | 1 Aliasing (raw-ptr aliasing into self.sequences / self.groups) | source-direct | PRESENT_STRONG | Every unsafe block has a paired SAFETY referencing "arena-owned entry, alive for the lifetime of BunTest". Multiple comments call out disjoint-field provenance for `sequence_ptr` and `group_ptr`. |
| `src/runtime/test_runner/timers/FakeTimers.rs` | jest mock-timer JSC bridge | 21 | 4 Provenance, 21 FFI | source-direct, with `bun_jsc::host_fn!` x 12 (`FAKE_TIMERS_FNS` table) | PRESENT_STRONG | Uses `safe fn` discipline inside `unsafe extern "C"` blocks where the precondition is module-private (`JSMock__setOverridenDateNow`). |
| `src/runtime/test_runner/harness/recover.rs` | `setjmp`/`longjmp`/`getcontext`/`setcontext` / Windows `RtlRestoreContext` | 17 | 21 FFI re-entry, 7 Async-cancel-safety | source-direct cfg-gated | PRESENT_STRONG | OS-specific extern blocks for both Windows ntdll path and POSIX. `unsafe fn get_context` / `set_context` document the ucontext_t writability contract. |
| `src/runtime/test_runner/pretty_format.rs`, `Order.rs`, `jest.rs`, `snapshot.rs`, `ScopeFunctions.rs`, `Collection.rs`, `DoneCallback.rs`, `diff_format.rs`, `debug.rs`, `expect/toContain.rs`, `expect/toContainEqual.rs`, `expect/toBeOneOf.rs`, `expect/toBeEmpty.rs`, `diff/diff_match_patch.rs` | misc test_runner support files | ~65 combined | 1 Aliasing, 4 Provenance, 21 FFI | source-direct + scattered `bun_jsc::host_fn!` | PRESENT_STRONG | Lower-density; raw-ptr round-trips into JSC bindings. |
| `src/runtime/image/backend_wic.rs` | Windows WIC (COM) image backend | 115 | 21 FFI re-entry, 6 Type-punning (fn-ptr transmute) | source-direct cfg(windows) | PRESENT_WEAK→STRONG | The one `transmute` in image (`WICConvertBitmapSourceFn` fn-ptr, line 921-923) has a SAFETY line. COM `Release` round-trips share upstream SAFETY blocks; this dominates the "missing comment" count. |
| `src/runtime/image/codec_png.rs` | libspng decode/encode | 29 | 21 FFI re-entry | `bun_opaque::opaque_ffi!` (1 invocation for `spng_ctx`) | PRESENT_STRONG | Pure FFI thin-wrapper; every extern fn has a typed-pointer signature. |
| `src/runtime/image/codec_jpeg.rs` | libjpeg-turbo (TurboJPEG) | 27 | 21 FFI re-entry | source-direct | PRESENT_STRONG | tj3DecompressHeader → tj3Decompress8 contract documented inline. |
| `src/runtime/image/codec_webp.rs` | libwebp + libwebpmux | 24 | 21 FFI, 6 ABI-version validity | source-direct | PRESENT_STRONG | ABI-version constants pinned to `scripts/build/deps/libwebp.ts` commit; SAFETY comments reference `WebPMalloc`-owned vs caller-owned memory contracts. |
| `src/runtime/image/codec_gif.rs`, `codec_bmp.rs`, `codecs.rs`, `quantize.rs`, `Image.rs`, `backend_coregraphics.rs`, `exif.rs`, `thumbhash.rs` | misc image codecs / dispatch | ~80 combined | 21 FFI re-entry | source-direct + `Zeroable` derive on `Dict` | PRESENT_STRONG | `unsafe impl bun_core::Zeroable for Dict` (codec_gif.rs:96) is the only `unsafe impl` in image. backend_coregraphics is macOS CoreGraphics CFRetain/CFRelease boundary. |
| `src/runtime/timer/mod.rs` | `All`: timer heap + scheduler driver | 55 | 1 Aliasing-callback (re-entrant `fire()` through `&mut All`) | source-direct + `bun_collections::IntrusiveHeap` | PRESENT_STRONG (with TODO) | **EXP-026 confirmed model**: `drain_timers` (line 1016) and `get_timeout` (line 897) carry exhaustive `PORT NOTE (§Forbidden aliased-&mut)` blocks documenting that re-entrant `(*runtime_state()).timer.{update,remove}()` from a fired handler mints a fresh `&mut All` to the same allocation. The bodies convert `self → *mut Self` up-front and form short-lived `&mut *this` only around `peek()`/`delete_min()`. **TODO(b2) at lines 908 and 1029** is real: EXP-026's Tree-Borrows model shows the `&mut self` receiver's protected tag can conflict with raw-owner re-entry even when no local `&mut` is held across the callback. |
| `src/runtime/timer/timer_object_internals.rs` | per-`TimerObject` state, fire path | 48 | 1 Aliasing, 21 FFI | source-direct | PRESENT_STRONG | Comments at line 817 spell out the `delete_min`/`drain_timers` UAF window. |
| `src/runtime/timer/WTFTimer.rs` | WTF (WebKit) timer C++ bridge | 23 | 21 FFI-callback | source-direct + `bun_event_loop::impl_timer_owner!` (1 invocation) | PRESENT_STRONG | `pub extern "C" fn WTFTimer__runIfImminent` is the re-entry doorway that timer/mod.rs warns about. |
| `src/runtime/timer/Timer.rs`, `EventLoopDelayMonitor.rs`, `DateHeaderTimer.rs`, `ImmediateObject.rs` | timer subtypes | ~28 combined | 1 Aliasing | source-direct | PRESENT_STRONG | All 5 `timer_all_mut()` calls live in `Timer.rs` (lines 210/234/255/280/321) and use the `&mut All` very briefly — only for `last_id` bump + a downstream `init` call. No `&mut all` held across re-entry in these specific call sites. Receiver still `&mut All` from `timer_all_mut`, so they participate in EXP-026's `TODO(b2)` scope. |
| `src/runtime/ffi/ffi_body.rs` | TinyCC JIT + dlopen + offset table | 51 | 21 FFI, 6 Type-punning, 3 Alignment (RacyCell) | source-direct | PRESENT_STRONG | **JIT W^X discipline**: `dangerously_run_without_jit_protections` toggles `pthread_jit_write_protect_np` exactly on aarch64-macOS, paired with `scopeguard::defer!` for re-enable on scope exit. `BUN_FFI_OFFSETS` declared as `bun_core::RacyCell<Offsets>` (UnsafeCell-transparent) — without this, C++ mutation would be UB against `extern static` immutability assumption. |
| `src/runtime/ffi/FFIObject.rs` | DOMJIT readers + slow-path host fns | 47 | 6 Type-punning (fn-ptr transmute from user usize), 3 Alignment, 5 Uninit | source-direct | PRESENT_STRONG | `deallocator_from_addr(addr: usize)` `unsafe fn` documents that `JSTypedArrayBytesDeallocator` (an `Option<unsafe extern "C" fn(...)>`) is null-pointer-optimised so the `transmute::<usize, _>` is layout-compatible. This is the canonical "user-supplied raw pointer round-trip through JS" hazard in bun:ffi. |
| `src/runtime/ffi/mod.rs`, `host_fns.rs` | open/close/compile/generate_symbols host fns + reads | ~21 combined | 21 FFI, 4 Provenance | source-direct | PRESENT_STRONG | `host_fns.rs` contains `unsafe extern "C"` declarations for C++-side helpers used by the FFI compile path. |
| `src/runtime/napi/napi_body.rs` | full N-API surface (115 `#[no_mangle] extern "C"` exports + 29 `unsafe extern` import blocks) | 120 | 21 FFI re-entry, 4 Provenance, 22 Send/Sync | source-direct + `bun_threading::intrusive_work_task!` | PRESENT_STRONG (with one gap) | 115 `pub extern "C" fn napi_*` exports are the Node-API contract surface, fixed by `js_native_api.h` / `node_api.h`. `unsafe impl bun_ptr::ExternalSharedDescriptor for NapiEnv` (line 210) routes `ref`/`deref` through C++-owned counts. **The one `unsafe impl Send/Sync` in J is `unsafe impl Sync for napi_node_version` (line 1994)** — POD with a `*const c_char` to a `'static` literal, SAFETY-documented. `ThreadSafeFunction` is a `Taskable` queued onto the main JS-thread event loop. `napi_threadsafe_function = *mut ThreadSafeFunction` means Rust's type system does not itself authorize cross-thread ownership transfer; the safety argument must come from the N-API C contract plus ThreadSafeFunction's atomic/Mutex/Condvar protocol. **Phase 2 should explicitly audit that protocol.** |
| `src/runtime/valkey_jsc/js_valkey.rs` | Redis/Valkey JSC bridge, async refcounted client | 39 | 1 Aliasing-callback (R-2 single-JS-thread `client_mut`), 4 Provenance | source-direct | PRESENT_STRONG | `client_mut(&self) → &mut valkey::ValkeyClient` (line 474) — R-2 contract: "fresh per call site; reentrancy through `ValkeyClient::parent()` forms a shared `&JSValkeyClient` only." Multiple `unsafe fn deref(this: *mut Self)` follow EXP-012-shape `*mut Self` discipline. `LinearFifo<Entry, _>` + `LinearFifo<PromisePair, _>` declared at `ValkeyCommand.rs:132/258` — **EXP-001 hot caller** (see cross-refs). |
| `src/runtime/valkey_jsc/valkey.rs`, `ValkeyCommand.rs`, `js_valkey_functions.rs` | command-queue + protocol helpers | ~6 combined | 4 Provenance | source-direct | PRESENT_WEAK→STRONG | Mostly thin port-helpers; `heap::take` on Drop. |
| `src/runtime/crypto/CryptoHasher.rs`, `EVP.rs`, `HMAC.rs`, `PBKDF2.rs`, `PasswordObject.rs`, `pwhash.rs`, `mod.rs`, `boringssl_jsc.rs` | BoringSSL EVP/HMAC/PBKDF2 + argon2/scrypt wrappers | 37 | 21 FFI (BoringSSL), 5 Uninit (MaybeUninit::<HMAC_CTX>) | source-direct | PRESENT_STRONG | **BoringSSL constant-time + OS-CSPRNG discipline confirmed**: `pwhash.rs:152` calls `getrandom::fill` for salt (no userspace PRNG); `HMAC.rs` zero-inits `HMAC_CTX` via `MaybeUninit::uninit` + `boringssl::HMAC_CTX_init`; no AES/ChaCha20 wrappers found in the section (all live in `bun_boringssl_sys`). 41 SAFETY lines vs 37 blocks ≈ 110 % coverage. **Zero `transmute` in crypto.** |
| `src/runtime/webview/ChromeProcess.rs` | Chrome / Chromium subprocess fork-exec + headless | 13 | 21 FFI, 7 Process management | source-direct cfg-gated (windows / macos / linux / android) | PRESENT_STRONG | Heavy `#[cfg(target_os)]` branching; one `unsafe extern "C"` block (line 571) for the C++-side `Bun__Chrome__*` exports. |
| `src/runtime/webview/HostProcess.rs` | WebView host (CEF/WebKit2GTK/WKWebView) subprocess | 8 | 21 FFI | source-direct cfg-gated | PRESENT_STRONG | One `unsafe extern "C"` block (line 237). |
| `src/runtime/allocators/LinuxMemFdAllocator.rs` | memfd-backed CoW Blob allocator | 15 | 1 Aliasing-IntrusiveArc, 4 Provenance, 22 Send (ThreadSafeRefCount) | `bun_ptr::ThreadSafeRefCounted` derive (1 invocation) | PRESENT_STRONG | Uses `bun_ptr::ThreadSafeRefCount` (atomic) instead of single-threaded `RefCount` because Blob stores cross threads. `unsafe fn deinit(this: *mut Self)` documented. No explicit `unsafe impl Send/Sync` because the derive emits them. |
| `src/runtime/webcore.rs` | runtime root re-exports + 3 unsafe blocks for FileSink / Pipe auto-flush trampolines | 4 | 21 FFI-callback | source-direct | PRESENT_STRONG | One `unsafe extern "C" fn trampoline<T>` (line 160) for `DeferredTaskQueue` callback, one `as_mut`-then-call on `Pipe<T>`, one routing call to `file_sink::FileSink::on_auto_flush`. |

## Bucket distribution (UB-TAXONOMY tags)

- **Bucket 1 (Aliasing — Stacked/Tree Borrows)**: very dominant. Timer (mod.rs:897/1016), test_runner (bun_test.rs `BunTestCell`, Execution.rs raw-ptr discipline), valkey_jsc (`client_mut`) all explicitly route around forming `&mut T` across re-entrant FFI / JS-call boundaries. Approximate count: ~260 sites.
- **Bucket 4 (Provenance — `Box::from_raw`, casts)**: ~70 sites. Heaviest in valkey_jsc (`bun_core::heap::{into_raw, take}` around the JSValkeyClient async client lifecycle) and napi (`napi_finalize` + `napi_remove_wrap` + `napi_threadsafe_function` finalizer paths).
- **Bucket 5 (Uninit / MaybeUninit)**: ~12 sites, almost all in `crypto/HMAC.rs` (`MaybeUninit::<HMAC_CTX>` + `HMAC_CTX_init`) and ffi (`Offsets` lazy load).
- **Bucket 6 (Type-punning / transmute)**: 5 sites — `image/backend_wic.rs:921-923` (fn-ptr from `GetProcAddress` to `WICConvertBitmapSourceFn`), `ffi/FFIObject.rs:32` (`transmute::<usize, JSTypedArrayBytesDeallocator>` — user-supplied address from `bun:ffi`), plus a few internal allocator casts.
- **Bucket 21 (FFI callback aliasing — re-entrancy)**: dominant across the section. Every codec, every napi export, every timer fire path, every BoringSSL call sits here. ~330 sites.
- **Bucket 22 (Send/Sync confusion)**: 1 explicit `unsafe impl Sync` (napi_body.rs:1994 `napi_node_version`). `allocators` `ThreadSafeRefCounted` derive auto-emits Send/Sync — sound because of the atomic refcount; **open**: cross-thread protocol audit for `napi::ThreadSafeFunction` (the exported handle is a raw pointer crossing the C ABI boundary, so Rust auto-traits do not prove the protocol).

## Macro-generated vs source-direct

- **Source-direct unsafe**: ~94 % of J's surface — `unsafe { ... }` blocks written inline with paired `// SAFETY:`.
- **Macro-generated unsafe**:
  - `bun_jsc::host_fn!` / `bun_jsc::jsc_host_abi!` — used heavily in test_runner (`FakeTimers.rs` `FAKE_TIMERS_FNS` table ~12 fns, `expect.rs` `__apply_custom_matcher_shim`, `DoneCallback.rs` `__jsc_host_bun_test_done_callback`). Each expansion emits one `unsafe fn` shim.
  - `bun_opaque::opaque_ffi!` — `spng_ctx` (codec_png), `Ref` (napi), `NapiHandleScope` (napi), `JSTypedArrayBytesDeallocator` placement. Each generates a ZST handle + `unsafe impl Send/Sync` glue (counted but contract-only).
  - `bun_threading::intrusive_work_task!` — invoked on `napi_async_work` (napi_body.rs:1839); emits the `Taskable` impl with an unsafe `from_task` raw-ptr recovery.
  - `bun_event_loop::impl_timer_owner!` — `WTFTimer.rs:59` (1 invocation, emits `from_timer_ptr` raw-ptr recovery).
  - `bun_ptr::ThreadSafeRefCounted` derive — `LinuxMemFdAllocator` (1 invocation, emits `unsafe impl Send + Sync` glue around an atomic refcount).
  - `bun_core::impl_field_parent!` — valkey_jsc `js_valkey.rs:115` (`SubscriptionCtx => JSValkeyClient._subscription_ctx`) — `#[repr(transparent)]`-relying.
- **NOT present in J**: no `bun_dispatch::link_impl_*!`, no `bun_ptr::RefCounted` derive on these types (they hand-write the impls), no `#[target_feature]`/`asm!` anywhere in J (image has zero SIMD).

## Cross-section anchor cross-refs

### EXP-001 (LinearFifo exposes uninitialized `MaybeUninit<T>` backing slots as `T`)

**Hot callers in Section J — confirmed:**

| location | T | confirmed |
|---|---|---|
| `src/runtime/test_runner/bun_test.rs:1503` | `LinearFifo<RefDataValue, DynamicBuffer<RefDataValue>>` | yes — `pub type ResultQueue = LinearFifo<RefDataValue, ...>;` |
| `src/runtime/valkey_jsc/ValkeyCommand.rs:132` | `LinearFifo<Entry, DynamicBuffer<Entry>>` | yes — exposed as `entry::Queue` |
| `src/runtime/valkey_jsc/ValkeyCommand.rs:258` | `LinearFifo<PromisePair, DynamicBuffer<PromisePair>>` | yes — exposed as `promise_pair::Queue` |

The EXP-001 shape is not only about niches. `DynamicBuffer<T>::as_slice()` and
`as_mut_slice()` reinterpret the entire `Box<[MaybeUninit<T>]>` as `&[T]` /
`&mut [T]`, including unused slots that have never been initialized as `T`.
Niche-bearing / validity-constrained `T` simply produce cleaner Miri witnesses.
Phase-2 follow-up: instantiate `LinearFifo<T, _>` under Miri with each of these
three `T`s and exercise `ensure_total_capacity` / readable-slice paths (the
unsafe cast lives in `src/collections/linear_fifo.rs` per the Section O note).
Hot-caller surface is **3 instantiations**.

### EXP-026 (`timer_all_mut() -> &'static mut timer::All` side condition)

`jsc_hooks.rs:152-157` definition is unchanged from prior audit. Section J's **timer/** internal callers' status:

- **`timer/Timer.rs` lines 210/234/255/280/321** — 5 callers. Each holds `let all = timer_all_mut();` for a short scope (`last_id` bump + 1-2 derived calls); none of those derived calls re-enter `runtime_state().timer`. **Status: respects side condition, but the `&mut All` lexical scope is wider than strictly needed.**
- **`timer/mod.rs:797`** (`unsafe { (*all).drain_timers(vm) }`) — `all` is `*mut`, drain_timers takes `&mut self` only inside, **OPEN TODO(b2)** (line 1029): "switch the signature to `this: *mut Self`."
- **`timer/mod.rs:897`** (`get_timeout`) — same EXP-026-shape hazard, same `TODO(b2)` (line 908).

**Verdict**: EXP-026's local body discipline is good (raw-ptr conversion inside the body and no explicit local `&mut all` held across `fire()`), but the **signatures still take `&mut self`** and the call-site auto-ref produces a `&mut All` for the call frame. Phase-5 Tree-Borrows model confirms that exact signature hazard. The TODO is real and should be fixed by raw-pointer receivers.

### Other anchors (informational)

- No `bun_dispatch::link_impl_*!` in J (those live in Section Q).
- No `Strong<T>` / `Weak<T>` instantiations in J — all jsc-handle work routes through bun_jsc which is Section K.
- One `unsafe impl Sync` in J (napi_body.rs:1994) — not an anchor, but worth noting for Section K's cross-walk of `unsafe impl Send/Sync` lines.

## napi audit

- **Surface**: 120 unsafe surface (83 blocks + 6 unsafe fn + 2 unsafe impl + 29 unsafe extern) in 1 file (`napi_body.rs`) + 1 module file.
- **`#[no_mangle] pub extern "C"` exports**: **115** — this is the Node-API contract surface. Signatures are fixed by `js_native_api.h` / `node_api.h` (vendored alongside `napi_body.rs`).
- **`unsafe extern "C"` import blocks**: 29, split between (a) Bun-private C++ helpers (`NapiEnv__ref/deref`, `NapiHandleScope__open/close/append/escape`, `NapiEnv__globalObject`, `JSObjectGetPrototype`), and (b) the **redeclared napi_* exports** themselves so the host-fns module can call them internally.
- **Refcount**: `NapiEnv` is `bun_ptr::ExternalShared<NapiEnv>` — externally refcounted by C++. The `unsafe impl ExternalSharedDescriptor for NapiEnv` documents that the pointee remains valid while C++ refcount > 0.
- **Handle scope**: `NapiHandleScope::open(env, escapable) -> *mut NapiHandleScope` returns null when called inside a finalizer; the helper that pairs it with `close()` is split into `with_capacity` / RAII guard.
- **Finalizers**: `napi_add_finalizer`, `napi_create_external`, `napi_remove_wrap`, `napi_wrap` all take `finalize_cb: napi_finalize` + `finalize_hint: *mut c_void` — the **N-API finalize hazard cluster**. Bodies dispatch through `NapiFinalizerTask: Taskable` (queued on the main JS thread). Phase-2 should verify the queued task can't observe the `napi_env` after the env's deinit drains the task queue.
- **`unsafe impl Send/Sync`**: 1 (`napi_node_version`, SAFETY-documented).
- **ThreadSafeFunction (`tsfn`)**: queued on the main JS-thread event loop via `Taskable for ThreadSafeFunction`. **Send/Sync is not explicitly impl'd**; the exported handle is `napi_threadsafe_function = *mut ThreadSafeFunction`, so Rust's auto-trait system is bypassed at the C ABI boundary rather than proving safety. Practically, `napi_call_threadsafe_function` is invoked from foreign threads. **Open**: Phase-2 — audit ThreadSafeFunction's atomics/Mutex/Condvar protocol as the actual cross-thread safety proof.
- **Validation**: every `unsafe extern "C"` block carries an `// SAFETY:` upstream; every `unsafe fn` carries `# Safety`. No `transmute`, no `set_len`, no `get_unchecked` in the section.

## ffi crate audit (TinyCC JIT boundary)

- **Surface**: 119 unsafe (88 blocks + 4 unsafe fn + 27 unsafe extern). 49 `extern "C"` exports.
- **JIT W^X discipline**: `dangerously_run_without_jit_protections(func)` in `ffi_body.rs:103-127` is the chokepoint that toggles `pthread_jit_write_protect_np(false)` and re-enables via `scopeguard::defer!`. Gated on `cfg!(all(target_arch = "aarch64", target_os = "macos"))` (only target where W^X is enforced). The docstring is explicit: "*Do not pass in user-defined functions (including JSFunctions).*"
- **Offsets table**: `BUN_FFI_OFFSETS: bun_core::RacyCell<Offsets>` (extern static) — C++ mutates the bytes after Rust startup, so a plain `static` would assert immutability to LLVM (UB). The SAFETY comment explicitly cites this.
- **User-supplied pointer reinterpretation**: `deallocator_from_addr(addr: usize) -> JSTypedArrayBytesDeallocator` (FFIObject.rs:24-33) — the canonical "untyped `usize` from JS land transmutes to a fn pointer" site. SAFETY is documented; it relies on `Option<unsafe extern "C" fn(...)>` being NPO-laid-out. A bad value crashes when JSC invokes it — not UB in Rust, but a hostile-input concern.
- **DOMJIT fast-path readers**: `FFIObject.rs:425-585` — 12 `unsafe extern "C"` fast-path readers (read_unaligned_at_*) called directly from JIT code with `callconv(jsc.conv)` per the Zig source. Every body SAFETY references "JIT-validated address."
- **TinyCC integration**: `bun_tcc_sys::State` (compile/relocate/add_symbol/define_symbol) is the API surface used inside `dangerously_run_without_jit_protections`. The `ffi_body.rs` header comment notes that body completion is gated on `Environment::ENABLE_TINYCC` (runtime), with `bun_tcc_sys` always linked at compile time.
- **No `transmute` outside the deallocator and the user-defined-callback path**.

## crypto audit (BoringSSL discipline)

- **Surface**: 37 blocks, 0 unsafe fn, 0 unsafe impl, 0 unsafe extern, 41 SAFETY lines (≈ 110 % coverage). 10 `extern "C"` (BoringSSL).
- **OS-CSPRNG only**: `pwhash.rs:152` `getrandom::fill(&mut salt)` for salt; no userspace PRNG seen in section. `RAND_bytes` / `RAND_priv_bytes` not invoked in J (they live behind `bun_boringssl_sys`).
- **Constant-time**: HMAC compare path goes through BoringSSL `CRYPTO_memcmp` (not Rust `==` on byte slices) — not in J's source, lives in `bun_boringssl_sys`.
- **MaybeUninit discipline**: `HMAC.rs:18-21` is canonical — `MaybeUninit::<HMAC_CTX>::uninit()` followed immediately by `HMAC_CTX_init(ctx.as_mut_ptr())`. No `assume_init` before the init call.
- **No `transmute`, no `mem::zeroed::<NonZero*>`, no `set_len` in the section**.
- **`from_raw_parts_mut` calls** in `CryptoHasher.rs` (lines 395, 710, 1004, 1341, 1504) are routed through `output_buf.ptr` (raw `*mut u8` field) explicitly to avoid `&[u8].as_ptr()` Stacked-Borrows UB — comment cites the hazard at each site.
- **Verdict**: BoringSSL discipline confirmed; the section meets the CLAUDE.md "constant-time used; OS CSPRNG only; no userspace PRNG" claim.

## Notable patterns

1. **EXP-026 `TODO(b2)`** is the only currently-known UB-shape hazard in J with a model witness. Receiver signature `&mut self` on `All::drain_timers` and `All::get_timeout` is not just a stylistic concern; Tree-Borrows confirms the call-frame protected tag can conflict with raw-owner re-entry.
2. **`BunTestCell` (test_runner)** is the cleanest expression of the R-2 "single-thread `UnsafeCell` + caller-discipline" pattern in J — a recent fix (now-renamed `buntest_as_mut`) removed a `*const T as *mut T` aliasing bug.
3. **`bun:ffi` user-supplied fn-pointer transmute** (`deallocator_from_addr`) is hostile-input-sensitive but Rust-sound.
4. **napi finalizer plumbing** is the densest source of `*mut c_void` round-trips in J; every queue-based path resolves through `NapiFinalizerTask: Taskable`, but the `napi_env`-lifetime-vs-queued-finalizer interleaving deserves explicit Phase-2 verification.
5. **Image backend split**: `backend_wic.rs` (Windows COM) carries the only `transmute` (fn-ptr from `GetProcAddress`); `backend_coregraphics.rs` (macOS CFRetain/CFRelease) and `codec_*.rs` (libspng/libjpeg-turbo/libwebp/libgif) are uniformly typed FFI thin-wrappers. **No SIMD in image** (no `#[target_feature]`, no `asm!`, no `repr(simd)`).
6. **Section J carries 1 of the workspace's 4 explicit `unsafe impl Sync`** (napi_node_version, POD with `'static` c_char pointer) — documented and sound.

## Open questions (Phase-2 candidates)

- Flip `All::drain_timers` and `All::get_timeout` receiver to `this: *mut Self`, change `jsc_hooks.rs` call sites to `addr_of_mut!` (closes EXP-026's `TODO(b2)`).
- Explicit cross-thread protocol audit for `napi::ThreadSafeFunction` (the type behind `*mut ThreadSafeFunction`; the raw pointer handle bypasses Rust auto-trait checking).
- Miri instantiation of `LinearFifo<RefDataValue, _>`, `LinearFifo<Entry, _>`, `LinearFifo<PromisePair, _>` to confirm or refute EXP-001 for J's hot callers.
- Finalizer queue / `napi_env` lifetime interleaving — verify queued `NapiFinalizerTask` cannot observe a freed `napi_env`.
- Verify `bun:ffi` `deallocator_from_addr` does not need a `0..MIN_NON_NULL` guard — currently bad input is "crashes when JSC invokes it"; could be tightened to a clean error path.
