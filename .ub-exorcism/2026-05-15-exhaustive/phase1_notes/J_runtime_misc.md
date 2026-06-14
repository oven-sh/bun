# Section J: runtime-misc (10 paths)

## Purpose (each sub-section in 1 sentence)

- **`src/runtime/test_runner/`** — Bun's Jest-compatible test runner: BunTest root, describe/it/expect scope graph, hook plumbing, snapshot/pretty-format, mock-timer (FakeTimers) JSC bridge, and the `setjmp`/`longjmp` recovery harness that lets a panicking test return to the runner.
- **`src/runtime/image/`** — `Bun.Image` decode/encode/transform pipeline; wraps libspng (PNG), libjpeg-turbo (JPEG), libwebp + mux (WebP), an internal GIF codec, internal BMP, plus OS backends (Windows WIC via COM, macOS CoreGraphics).
- **`src/runtime/timer/`** — `setTimeout`/`setInterval`/`setImmediate` + WebKit-side `WTFTimer` reentry bridge; owns the heap-based timer schedule and the `drain_timers`/`get_timeout` re-entry-safe call paths called from `jsc_hooks::auto_tick`.
- **`src/runtime/ffi/`** — `bun:ffi`'s user-facing native-function bridge: dlopen handles, type-resolved trampolines, TinyCC-JIT compile path, DOMJIT fast-path readers, and the `Offsets`/`exposed_to_ffi` bookkeeping shared with the C++ side.
- **`src/runtime/napi/`** — N-API (Node-API) shim: 115 `pub extern "C" fn napi_*` exports against the fixed `js_native_api.h` / `node_api.h` ABI, plus `NapiEnv`/`NapiHandleScope`/`ThreadSafeFunction`/`napi_async_work`/`napi_finalize` plumbing.
- **`src/runtime/valkey_jsc/`** — `Bun.Redis` (Valkey) async client + JSC bridge: refcounted `JSValkeyClient`, two `LinearFifo` command queues, subscription contexts, TLS via `SSL_CTX_free`.
- **`src/runtime/crypto/`** — WebCrypto + `node:crypto` JSC layer: `CryptoHasher` (one-shot + streaming), `EVP` (BoringSSL EVP_*), `HMAC`, `PBKDF2`, `PasswordObject` (argon2/scrypt via pwhash), plus `boringssl_jsc` error-format bridge.
- **`src/runtime/webview/`** — `Bun.WebView` Chrome / WebView host subprocess fork-exec; OS-specific cfg-gated process launching for Windows / macOS / Linux / Android.
- **`src/runtime/allocators/`** — One file: `LinuxMemFdAllocator`, the memfd-backed CoW allocator used by `Blob` for large repeatedly-cloned data.
- **`src/runtime/webcore.rs`** — Single root file with re-exports and 3 unsafe blocks for `FileSink` / `Pipe` auto-flush trampolines that the runtime crate hands to `DeferredTaskQueue`.

## Per-path unsafe-surface tally (vs prior ~789)

| path | site_count | dominant_kind | dominant_bucket |
|---|---:|---|---|
| `src/runtime/test_runner/` | 228 | `unsafe { }` blocks around arena-owned-entry raw-ptr round-trips; `BunTestCell` UnsafeCell wrapper | 1 (Aliasing — caller-discipline UnsafeCell) + 21 (FFI JSC host fn) |
| `src/runtime/image/` | 208 | `unsafe extern "C"` libspng/libjpeg/libwebp/WIC blocks; COM round-trips | 21 (FFI re-entry) + 6 (one fn-ptr transmute) |
| `src/runtime/timer/` | 153 | raw-ptr discipline in `All::{drain_timers,get_timeout}`; `WTFTimer__fire` re-entry | 1 (Aliasing — re-entrant `&mut All`) + 21 (FFI) |
| `src/runtime/ffi/` | 119 | TinyCC JIT W^X toggle; DOMJIT fast-path readers; `Offsets` RacyCell; user-supplied fn-ptr transmute | 21 (FFI) + 6 (Type-punning) + 3 (Alignment) |
| `src/runtime/napi/` | 120 | 115 `napi_*` C-ABI exports + 29 `unsafe extern` import blocks; `NapiEnv` external refcount | 21 (FFI) + 4 (Provenance) + 22 (Send/Sync — 1 explicit) |
| `src/runtime/valkey_jsc/` | 40 | `*mut Self` deref / `client_mut` R-2 single-JS-thread pattern; intrusive refcount; 2 LinearFifo queues | 1 (Aliasing-callback) + 4 (Provenance) |
| `src/runtime/crypto/` | 37 | BoringSSL EVP_* thin wrappers; `MaybeUninit::<HMAC_CTX>` init; OS-CSPRNG salt | 21 (FFI BoringSSL) + 5 (Uninit) |
| `src/runtime/webview/` | 21 | cfg-gated `Bun__{Chrome,WebViewHost}__*` C-ABI surface | 21 (FFI) + 7 (Process management) |
| `src/runtime/allocators/` | 15 | `LinuxMemFdAllocator` intrusive ThreadSafeRefCount; mmap/munmap/memfd_create | 1 (Aliasing-IntrusiveArc) + 4 (Provenance) + 22 (Send via atomic refcount) |
| `src/runtime/webcore.rs` | 4 | `DeferredTaskQueue` auto-flush trampoline | 21 (FFI-callback) |
| **TOTAL** | **942** | — | — |

Delta vs prior `phase0_partition.json` (789): **+153** (≈ +19 %). The growth is dominated by ongoing Zig→Rust ports landed since the prior audit (image codecs +37, napi handle-scope/tsfn port +20, timer scheduler raw-ptr discipline rewrite +30, test_runner `expect`/`Execution` +30) plus the fact that every `bun_jsc::host_fn!` / `jsc_host_abi!` macro expansion now appears as one `unsafe fn` shim at the call site.

## Cross-section anchor cross-refs

### EXP-001 callers in test_runner / valkey_jsc — confirmed shapes

| location | type | confirmed in source |
|---|---|---|
| `src/runtime/test_runner/bun_test.rs:1503` | `LinearFifo<RefDataValue, DynamicBuffer<RefDataValue>>` | yes |
| `src/runtime/valkey_jsc/ValkeyCommand.rs:132` | `LinearFifo<Entry, DynamicBuffer<Entry>>` | yes (`entry::Queue`) |
| `src/runtime/valkey_jsc/ValkeyCommand.rs:258` | `LinearFifo<PromisePair, DynamicBuffer<PromisePair>>` | yes (`promise_pair::Queue`) |

The EXP-001 hot caller set in J is **3 instantiations** with `T ∈ {RefDataValue, Entry, PromisePair}`. The underlying shape is broader than "niche-bearing `T`": `DynamicBuffer<T>::as_slice()` / `as_mut_slice()` reinterpret the whole `Box<[MaybeUninit<T>]>` as `&[T]` / `&mut [T]`, including unused slots that have never been initialized as `T`. Validity-constrained `T` only make the witness easier to observe under Miri. All three Section-J `T`s are non-trivial (`RefDataValue` has enum validity and `NonNull`; Valkey `Entry` / `PromisePair` own `Box` / JSC promise handles), so Phase 2 owes a Miri instantiation per type rather than relying on the old "byte buffer" assumption.

### EXP-026 (`timer_all_mut`) side-condition check

`jsc_hooks.rs:152-157` definition unchanged:

```rust
pub fn timer_all_mut() -> &'static mut timer::All {
    let state = runtime_state();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`;
    // single JS thread so no concurrent `&mut`.
    unsafe { &mut (*state).timer }
}
```

The side condition is "no other live `&mut All` exists when this function is called, *and* the returned `&'static mut` is not aliased by any subsequent call before it is dropped." Section J's timer-internal callers:

| call site | shape | side-condition status |
|---|---|---|
| `timer/Timer.rs:210, 234, 255, 280, 321` | `let all = timer_all_mut(); all.last_id += 1; …` | **OK in current source** — `&mut all` is held only for `last_id` bump + 1-2 derived calls (`js_value_to_countdown`, `Init::init`); none of those re-enter `runtime_state().timer`. |
| `timer/mod.rs:797` (`drain_timers`) | raw-ptr inside body; `&mut self` parameter | **CONFIRMED_UB model / TODO(b2)** at line 1029 — current body converts `self → *mut Self` up-front and forms only short-lived `&mut *this` borrows around `peek()`/`delete_min()`, dropping them before each `fire()`. But the *signature* still binds `&mut self`; EXP-026's Tree-Borrows model confirms this call-frame protected tag can conflict with raw-owner re-entry. |
| `timer/mod.rs:897` (`get_timeout`) | same shape | **CONFIRMED_UB model / TODO(b2)** at line 908 — `(*min).fire(...) → WTFTimer__fire → (*runtime_state()).timer.update(...)` is the re-entry path being defended against. |

**Verdict**: the local body discipline is good (no explicit local `&mut all` is held across `fire()`), but the call-frame `&mut self` receiver is itself enough to matter under Tree Borrows. EXP-026 now has a model witness and should be fixed by the signature flip already described in the TODOs.

## napi audit

- N-API is the Node-Native-Addons compatibility shim. The `napi.h` interface is fixed by Node; Bun must match.
- **Surface**: 1 file (`napi_body.rs`, 157 KB) + 1 module re-export file. 120 unsafe surface (83 blocks + 6 unsafe fn + 2 unsafe impl + 29 unsafe extern).
- **115 `#[no_mangle] pub extern "C" fn napi_*` exports** vs prior audit count 85 — growth reflects fresh `napi_create_*` / `napi_get_*` ports landed since the prior audit.
- **`unsafe extern "C"` import blocks**: 29, used for (a) Bun-private C++ helpers (`NapiEnv__ref/deref`, `NapiHandleScope__open/close/append/escape`, `NapiEnv__globalObject`), (b) JSC internals (`JSObjectGetPrototype`, `JSC__JSValue__isStrictEqual`), and (c) **re-declaration of napi_* exports** for internal call sites. The duplicate-decl is suppressed via `#[allow(clashing_extern_declarations)]` (line 257) because some types (`NapiHandleScope`) are private to this crate.
- **External refcount**: `unsafe impl bun_ptr::ExternalSharedDescriptor for NapiEnv` (line 210) — pointee remains valid while C++ count > 0; `ext_ref` / `ext_deref` carry `# Safety` docs.
- **Finalize hazard cluster**: `napi_add_finalizer`, `napi_wrap`, `napi_remove_wrap`, `napi_create_external`, `napi_create_external_buffer`, `napi_create_external_arraybuffer`, `napi_create_threadsafe_function`. All take `finalize_cb: napi_finalize = Option<extern "C" fn(napi_env, *mut c_void, *mut c_void)>` + `finalize_hint: *mut c_void`. The finalizer dispatcher is `NapiFinalizerTask: Taskable` (queued on the main JS thread). **Phase-2 owes**: verify the queued task cannot observe `napi_env` after the env's deinit drains the task queue.
- **ThreadSafeFunction**: `napi_threadsafe_function = *mut ThreadSafeFunction`. `impl Taskable for ThreadSafeFunction` queues the call onto the main JS-thread event loop. **No explicit `unsafe impl Send/Sync` on `ThreadSafeFunction`**; the raw pointer crosses the C ABI boundary, which bypasses Rust auto-trait checking rather than proving safety. **Phase-2 owes**: audit the atomic/Mutex/Condvar protocol that makes foreign-thread calls safe.
- **Validity invariants**: `napi_status` is `#[repr(u32)]`; `napi_node_version` is the only `unsafe impl Sync` (POD with `'static` literal pointer; SAFETY-documented at line 1993).
- **No `transmute`, no `set_len`, no `get_unchecked`, no `assume_init`** in the napi section (counter on the trans/uninit/setlen/etc column is **0**).

## ffi crate audit (TinyCC JIT boundary)

- `bun:ffi` is Bun's user-facing FFI feature. JIT trampolines are compiled at runtime via TinyCC (`bun_tcc_sys`).
- **Surface**: 119 unsafe (88 blocks + 4 unsafe fn + 27 unsafe extern), 49 `extern "C"` exports.
- **JIT W^X toggle**: `dangerously_run_without_jit_protections(func)` (ffi_body.rs:103-127) — the *single* chokepoint that flips `pthread_jit_write_protect_np(false)` on entry and restores via `scopeguard::defer!` on scope exit. Gated to `cfg!(all(target_arch = "aarch64", target_os = "macos"))` (only platform requiring it). Doc: *"Do not pass in user-defined functions (including JSFunctions)."*
- **`BUN_FFI_OFFSETS`**: declared `extern "C"` as `bun_core::RacyCell<Offsets>` because C++ mutates the bytes after Rust startup. SAFETY comment explicitly cites that a plain extern static would assert immutability to LLVM (UB).
- **DOMJIT fast-path readers**: 12 of them in FFIObject.rs:425-585 (`read_unaligned_at_*`), called directly from JIT code with `callconv(jsc.conv)` per the Zig source. Every body's SAFETY references "JIT-validated address" — the contract is that JSC's DOMJIT type-checker has already proven the address valid.
- **User-supplied fn-pointer transmute**: `deallocator_from_addr(addr: usize) -> JSTypedArrayBytesDeallocator` (FFIObject.rs:24-33). Layout-compatible because `Option<unsafe extern "C" fn(...)>` is NPO over a single pointer-sized word. SAFETY-documented; **bad input crashes at JSC invocation time** — not UB in Rust, but hostile-input-sensitive.
- **TinyCC integration**: `bun_tcc_sys::State` (`compile`/`relocate`/`add_symbol`/`define_symbol`) is the API surface used inside `dangerously_run_without_jit_protections`. `ffi_body.rs` notes some symbol resolution is gated behind `Environment::ENABLE_TINYCC` (runtime), but `bun_tcc_sys` is always linked at compile time.
- **No `transmute` outside `deallocator_from_addr` and the WIC fn-ptr in image**.

## crypto audit (BoringSSL discipline)

- **Surface**: 37 blocks, 0 `unsafe fn`, 0 `unsafe impl`, 0 `unsafe extern` (all BoringSSL imports come from `bun_boringssl_sys`). **41 SAFETY lines vs 37 blocks ≈ 110 % coverage.**
- **OS CSPRNG only, confirmed**: `pwhash.rs:152` uses `getrandom::fill(&mut salt)` for salt generation. No userspace PRNG anywhere in J. `RAND_bytes` / `RAND_priv_bytes` not called from J (live behind `bun_boringssl_sys`).
- **Constant-time comparisons**: HMAC compare goes through BoringSSL `CRYPTO_memcmp` (not Rust `==`) — call site lives in `bun_boringssl_sys`. No `byte_array_compare`, no `slice::cmp` on secret material in J.
- **MaybeUninit discipline**: `HMAC.rs:18-21` —
  ```rust
  let mut ctx = MaybeUninit::<boringssl::HMAC_CTX>::uninit();
  // SAFETY: HMAC_CTX is a POD opaque, init via HMAC_CTX_init.
  unsafe { boringssl::HMAC_CTX_init(ctx.as_mut_ptr()) };
  ```
  No `assume_init` before the init call. Canonical pattern.
- **`from_raw_parts_mut` discipline**: 4 call sites in `CryptoHasher.rs` (lines 395, 710, 1004, 1341, 1504) all route through `output_buf.ptr` (a raw `*mut u8` field), *explicitly* to avoid `&[u8].as_ptr()` Stacked-Borrows UB — comment cites the hazard at each site (lines 394, 1340, 1503).
- **Zero `transmute`, zero `set_len`, zero `mem::zeroed::<NonZero*>`** in the crypto section.
- **Verdict**: matches CLAUDE.md claim — "BoringSSL constant-time used; OS CSPRNG only; no userspace PRNG." Confirmed.

## Notable patterns

1. **EXP-026 `TODO(b2)`** — confirmed model witness for the call-frame `&mut self` hazard. Closing requires receiver-signature flip on `All::drain_timers` and `All::get_timeout` + `addr_of_mut!` at the `jsc_hooks.rs` call sites.
2. **`BunTestCell` as the canonical R-2 wrapper** — test_runner's `UnsafeCell` + `# Safety`-documented `unsafe fn buntest_as_mut` is the cleanest expression of the single-thread-discipline pattern in J. A previous version had a `*const T as *mut T` cast that was removed (per comment at line 421).
3. **`bun:ffi` user-supplied fn-pointer transmute** — `deallocator_from_addr` is Rust-sound (NPO layout) but hostile-input-sensitive. Counterpart hazard: any address can be supplied, and JSC will call through it on free.
4. **napi finalizer plumbing** — densest concentration of `*mut c_void` round-trips in J. `NapiFinalizerTask: Taskable` queues onto the main JS thread, but the env-lifetime interleaving deserves explicit Phase-2 verification.
5. **Image backend split**: `backend_wic.rs` (Windows COM) carries the only `transmute` in image (fn-ptr from `GetProcAddress` to `WICConvertBitmapSourceFn`). All other codecs (libspng, libjpeg-turbo, libwebp, internal GIF/BMP, CoreGraphics) are typed FFI thin-wrappers. **No SIMD anywhere in image** (no `#[target_feature]`, no `asm!`, no `repr(simd)`).
6. **Section J carries 1 of the workspace's explicit `unsafe impl Sync`** (`napi_node_version`, POD with `'static` literal pointer; SAFETY-documented).
7. **No `Strong<T>` / `Weak<T>` instantiations in J** — all jsc handles route through `bun_jsc` (Section K).

## Open questions (Phase-2 candidates)

- Flip `All::drain_timers` and `All::get_timeout` receiver to `this: *mut Self`, switch `jsc_hooks.rs` call sites to `addr_of_mut!(...)`. Closes EXP-026 `TODO(b2)`.
- Miri instantiation of `LinearFifo<RefDataValue, _>`, `LinearFifo<Entry, _>`, `LinearFifo<PromisePair, _>` to confirm/refute EXP-001 application for J's 3 hot callers.
- Explicit cross-thread protocol audit for `napi::ThreadSafeFunction` (the type behind `*mut ThreadSafeFunction`; the raw pointer handle bypasses Rust auto-trait checking).
- Verify finalizer-queue ↔ `napi_env`-lifetime interleaving — queued `NapiFinalizerTask` must not observe a freed env.
- Tighten `bun:ffi` `deallocator_from_addr` to filter `0..MIN_NON_NULL` (currently relies on JSC's invocation crash to surface bad input).
- Cross-walk valkey_jsc's `client_mut` against the EXP-012 close/cancel discipline (Section F anchor) — the patterns rhyme; verify no path holds `&mut self` across the Drop guard in `js_valkey.rs:1632-1652`.
