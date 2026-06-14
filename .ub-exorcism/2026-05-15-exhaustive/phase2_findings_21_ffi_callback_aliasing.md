# Phase 2 Bucket 21: FFI Callback Aliasing — findings

Static-bucket sweeper run for Bucket 21 (`*mut` from FFI callbacks: a C
library re-enters Rust while a `&mut` is live; Rust passes `&mut T` as
`*mut` to C that retains and calls back later; "both sides think they
are the only writer" hazards). Source-tree-only (no Miri, no TSan).
Numbers are workspace-wide unless scoped.

This bucket is the densest re-entrancy surface in the Rust codebase —
the project is fundamentally a JavaScript runtime sitting on top of
libuwsockets/JSC/libuv/c-ares, and every async event is a foreign
upcall into Rust. The dominant maintainer-applied mitigation is the
"R-2" discipline crystallised by EXP-012's fix (`unsafe fn cancel(this:
*mut Self)` + `bun_ptr::ThisPtr` + `ref_guard` RAII bracket); the
secondary mitigation is the uSockets `RawPtrHandler` adapter
(`src/runtime/socket/uws_handlers.rs:222-360`) that propagates `*mut
Self` into every `on_*` event for consumers that may free `self`
mid-callback.

**Current-status overlay (Codex follow-up, 2026-05-16):** this file is a
Phase-2 static sweep, so some `OPEN` labels below are historical. The current
registry verdicts are: EXP-010 bundler parallel-callback aliasing =
**CONFIRMED_UB**; EXP-026 `timer::All` re-entry =
**CONFIRMED_UB**; EXP-044 BundleV2 plugin trampoline =
**CONFIRMED_UB**; EXP-060 N-API `ThreadSafeFunction` raw-handle aliasing =
**CONFIRMED_UB**; EXP-099 node-cluster IPC singleton re-entry =
**CONFIRMED_UB**; EXP-100 `UpgradedDuplex` / `SSLWrapper` callback re-entry =
**CONFIRMED_UB**; EXP-101 `ProxyTunnel::shutdown(&mut self)` callback re-entry leftover =
**CONFIRMED_UB**; EXP-102 `ProxyTunnel::write(&mut self, buf)` callback re-entry leftover =
**CONFIRMED_UB**; EXP-103 `ProxyTunnel::on_writable(&mut self)` / `receive(&mut self, ...)` raw-capture-first callback re-entry leftovers =
**CONFIRMED_UB**; EXP-104 `WindowsNamedPipe` `WRAPPER_BUSY` receiver-protector gap =
**CONFIRMED_UB**; EXP-106 `PipeWriter` / `FileSink` parent-callback writer re-entry =
**CONFIRMED_UB**; EXP-028 DirectoryWatchStore draft-type claim =
**NO_EVIDENCE** for current production source; EXP-030 ThreadPool::Queue loom =
**NO_EVIDENCE**; EXP-070 macro borrow-mode linter =
**DEFERRED** remediation design. Treat rows below as the sweep narrative, not
the live verdict source.

---

## Topline workspace counts

| metric | count | source |
|---|---:|---|
| `pub extern "C" fn` declarations | 379 | `rg 'pub extern "C" fn' --type rust src/` |
| `unsafe extern "C" fn` declarations | 366 | `rg 'unsafe extern "C" fn' --type rust src/` |
| `unsafe extern "C" { … }` import blocks | 467 | `rg 'unsafe extern "C" \{' --type rust src/` |
| `#[no_mangle]` / `#[unsafe(no_mangle)]` / `#[unsafe(export_name)]` | 516 | combined |
| `unsafe fn name(this: *mut Self, …)` signatures | 337 | `rg 'unsafe fn .*\(this: \*mut Self' --type rust src/` |
| `bun_ptr::ThisPtr` / `ref_guard` / `ref_scope` / `ScopedRef` uses | 215 | `rg 'ref_guard\|ref_scope\|ScopedRef\|ThisPtr' --type rust src/` |
| files with `*mut Self` callback pattern | 82 | |
| files with `ref_guard`/`ref_scope` pattern | 29 | |
| `bun_io::impl_streaming_writer_parent!` invocations (modes `mut`/`shared`/`ptr`) | 2 | `FileSink` (`ptr`), `WindowsNamedPipe` (`mut`) |
| files containing FFI-callback `pub extern "C" fn` | 140 | |

For Bucket-21 purposes the **direct upcall surface** (number of
distinct Rust functions that C/C++ can invoke synchronously while the
calling thread may already be mid-Rust-borrow) is the union of `pub
extern "C" fn` + `unsafe extern "C" fn` minus pure FFI thunks that
neither read nor write self-state — conservatively **~600 sites**, of
which the `*mut Self` discipline shows up on **337 sites** (~56 %).

---

## Cross-refs to existing EXP entries

| EXP-ID | file:line | severity | one-line |
|---|---|---|---|
| EXP-010 | `src/bundler/LinkerContext.rs:1657-1663`; `linker_context/{generateCompileResultForJSChunk.rs:54-62, generateCompileResultForCssChunk.rs:45-46, prepareCssAstsForChunk.rs:76-80}` | CONFIRMED_UB (TB model) | bundler parallel-callback `&mut LinkerContext` 5-site cluster (B-1..B-5) — workers each derive their own `&mut LinkerContext` from the same raw parent under `each_ptr` fan-out (parallelism makes the aliasing simultaneous, not just sequential) |
| EXP-011 | `src/picohttp/lib.rs:383` | CONFIRMED_UB (TB model) | C library (picohttpparser) returns `*const c_char` derived from a `&[u8]` request buffer; Rust then writes a NUL through the cast; pure callback-aliasing-of-the-second-kind (Rust passes provenance-restricted reference into C and C hands it back as `*mut`-castable) |
| EXP-012 | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` | RESOLVED | the canonical Bucket-21 fix model: `pub unsafe fn cancel(this: *mut Self)` + `ThisPtr::new(this)` + `let _guard = this.ref_guard();` brackets `tcp.close()` re-entry into `handle_close` |
| EXP-026 | `src/runtime/timer/mod.rs:897, 1016`; `src/runtime/jsc_hooks.rs:152-157` | CONFIRMED_UB (TB model) | `All::drain_timers`/`get_timeout` still take `&mut self`; the call-site `(*state).timer.drain_timers(vm)` materialises a protected `&mut All` argument that re-enters via `WTFTimer__fire → update/remove`. Receiver should flip to `this: *mut Self` per the in-source `TODO(b2)` |
| EXP-099 | `src/runtime/node/node_cluster_binding.rs:35-51,147-158`; `src/jsc/ipc.rs:140-159` | CONFIRMED_UB (TB model) | `child_singleton<'a>() -> &'a mut InternalMsgHolder` mints a safe mutable singleton reference, then `InternalMsgHolder::flush(&mut self)` runs JS callbacks that can re-enter `child_singleton()` while the receiver's protected tag remains live. `black_box(ptr::from_mut(self))` forces reloads but does not erase the original `&mut self` borrow. |
| hardening only | `src/runtime/server/HTMLBundle.rs:154` (`pub struct Route`) | REVIEWED-CLEAN | Route stores per-field state behind `UnsafeCell` and exposes only `&self` methods because the uws `on_aborted` callback and the JSBundleCompletionTask backref both re-enter the Route while a prior `&Route` may be on the stack. **This is the safe-pattern reference** for Bucket 21. Keep as a regression watchpoint if new plain fields are added, not as a confirmed UB entry. |
| EXP-044 | `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/api/JSBundler.rs:1387-1405` | CONFIRMED_UB_SHAPE | `unsafe { &mut *self.bv2 }` JS-loop trampoline reborrow of `&mut BundleV2<'static>`; `Resolve` and `Load` plugin contexts each carry a `bv2: *mut BundleV2<'static>` raw backref and re-enter the bundler from the JS thread while bundler-thread worker may still hold a `&mut BundleV2` — same cross-thread shape as EXP-010 but on the root bundler object |
| EXP-100 | `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; `src/uws_sys/lib.rs:191-201` | CONFIRMED_UB (TB model) | `UpgradedDuplex` exports callback-facing `&mut self` methods that borrow `&mut self.wrapper` and call `SSLWrapper`; SSLWrapper synchronously calls back through `ctx: *mut UpgradedDuplex`, whose callbacks materialize `&mut UpgradedDuplex` and can set `self.wrapper = None`. Contrast `ProxyTunnel`'s raw-owner + disjoint-field accessor pattern, while preserving the EXP-101/102/103 caveat that four stale `&mut self` wrappers still need migration. |
| EXP-101 | `src/http/ProxyTunnel.rs:707-711`; callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | CONFIRMED_UB (TB model) | `ProxyTunnel` contains the correct `close_raw`/`wrapper_mut`/disjoint-field callback discipline, but `shutdown(&mut self)` still calls `SSLWrapper::shutdown` under a whole-struct receiver borrow. The EXP-101 bad path fails; the raw-owner control path passes. |
| EXP-102 | `src/http/ProxyTunnel.rs:768-775`; callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | CONFIRMED_UB (TB model) | `ProxyTunnel::write(&mut self, buf)` is the live request-body/header sibling of EXP-101. It calls `SSLWrapper::write_data` under a whole-struct receiver borrow; `write_data` can synchronously reach `handle_traffic`, `write_encrypted`, and close callbacks. The EXP-102 bad path fails; the raw-owner `write_raw` control path passes. |
| EXP-103 | `src/http/ProxyTunnel.rs:714-749,752-765`; callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | CONFIRMED_UB (TB model) | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` capture `NonNull<Self>` first, but that does not end the protected receiver tag. The subsequent `SSLWrapper::flush` / `receive_data` calls can synchronously invoke callbacks that raw-write fields; the raw-owner control modes pass. |
| EXP-104 | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; thunk macro `src/jsc_macros/lib.rs:828-843` | CONFIRMED_UB (TB model) | `WindowsNamedPipe`'s `WRAPPER_BUSY` guard defers wrapper drop correctly, but representative callback-driving paths still enter `SSLWrapper` while a whole-struct `&mut self` receiver is protected. The generated export shape applies to methods like `flush` / `encode_and_write` / `close` / `shutdown`; `on_read`, `on_internal_receive_data`, and `start_tls` are internal same-shape entries. EXP-104 directly models `flush` and receive paths; raw-owner controls pass. |
| EXP-106 | `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; parent exemplar `src/runtime/webcore/FileSink.rs:463-531` | CONFIRMED_UB (TB model) | `PipeWriter` completion paths launder `ptr::from_mut(self)` and call `Parent::on_write`; `FileSink::on_write` can then re-enter `writer.with_mut(|w| w.end()/close())`, minting a fresh `&mut Writer` while the writer completion receiver is still protected. The EXP-106 bad path fails; the raw-owner writer-completion control passes. |

Registry correction: early notes used `EXP-030` for the BundleV2 row before
the registry was normalized. The canonical BundleV2 entry is now `EXP-044`;
`EXP-030` is the ThreadPool::Queue loom model. HTMLBundle::Route has no EXP
entry because the source audit treats it as the good `&self` + `UnsafeCell`
design, not a defect.

---

## Per-callback-family table

The Rust↔C re-entrancy surface partitions into ~10 callback families,
each with its own ABI shape and its own re-entry contract. The
following table is the authoritative inventory; rows are ordered by
descending count of distinct Rust callback entry points.

| family | sites | shape | aliasing contract | fix-model status |
|---|---:|---|---|---|
| **napi exports** | **115 + 29 imports** (Section J, `napi_body.rs`) | `pub extern "C" fn napi_*(env_, …) -> napi_status` — fixed by `js_native_api.h` / `node_api.h` | C-ABI: caller is a native addon on any thread; **`napi_env` opaque to addon**; Rust forms a fresh `&NapiEnv` on each call via `bun_ptr::ExternalShared::deref`. Finalizers (`napi_finalize`) and `ThreadSafeFunction` are the hot re-entrancy cluster: `tsfn` is queued to the JS event loop and the user-supplied `call_js_cb` may re-enter `napi_*` while the JS thread is already mid-borrow of the same `NapiEnv` | **mature**: every `napi_*` body forms references through the ExternalShared refcount, but the **`ThreadSafeFunction` cross-thread protocol (Mutex/Condvar/atomic counts)** is the actual safety proof and has **not** been audited under loom/TSan |
| **uSockets `on_*` (socket trampolines)** | **11 in vtable.rs + 7 WebSocket + 7 H3** (Section Q) | `pub extern "C" fn on_open/on_data/on_writable/on_close/on_timeout/on_long_timeout/on_end/on_connect_error/on_handshake/on_fd/on_connecting_error` parameterised over `H: Handler` | Each trampoline calls `H::on_*(Self::ext(s), s, …)` where `ext()` returns `&'static mut H::Ext` (lies about `'static`; lifetime really bounded by the call). **Re-entrancy depth determined entirely by `H::on_*` body** — if the body calls `socket.write` and that synchronously fires `on_writable`, a second `&mut H::Ext` to the same allocation is created | **two-mode adapter**: `runtime/socket/uws_handlers.rs` ships **`PtrHandler<T>`** (forms `&mut T`, sound when re-entry only needs `&T`) **and `RawPtrHandler<T>`** (forms `*mut T`, no reference materialised). Consumers that may free or re-enter `T` mid-call (`websocket_client`, `Subprocess`, `ClientSession`) opt into `RawPtrHandler`. This is the **dominant correctly-applied fix model in the codebase** |
| **JSC host functions (`pub extern "C" fn`)** | **~120** scattered across `src/jsc/` (Sections F, K) | `pub extern "C" fn HostFn(global: *mut JSGlobalObject, args: …) -> JSValue` (synchronous JS→Rust callback), plus runtime-state hooks: `Bun__transpileFile`, `Bun__fetchBuiltinModule`, `WTFTimer__runIfImminent`, `Zig__GlobalObject__resolve`, the ConsoleObject family, ConcurrentCppTask__createAndRun, AbortSignal__Timeout__run/deinit | C++ calling convention; recovers `RuntimeState` via `thread_local!` `Cell<*mut RuntimeState>`; raw-place reads on `(*vm).field` are the consistently-applied pattern. **`timer_all_mut() -> &'static mut timer::All`** at `jsc_hooks.rs:152-157` is the one safe accessor that synthesises a `&'static mut` and trusts callers not to span re-entry | **mostly mature**: F-section audit confirms 86 % SAFETY coverage and uniform `*mut Self` for cancel/destroy paths. **EXP-026 hole**: `timer::All::{drain_timers, get_timeout}` still take `&mut self` despite the in-source `TODO(b2)` at lines 908 and 1029 |
| **c-ares callbacks** | **~30** (Section I+Q, `cares_sys/c_ares.rs:333-797, 1290, 1518` + 9 in dns_jsc `impl_cares_record_type!`) | `unsafe extern "C" fn on_sock_state<C: ChannelContainer>(ctx, socket, readable, writable)`, `unsafe extern "C" fn callback_wrapper<T>(*mut c_void, c_int, c_int, *mut hostent)`, `ares_addrinfo_callback` family, `host_callback_wrapper`, `callback_wrapper_cname/ns/ptr`, `ares_reply_callback<R, T>` | `Channel` is **proven ZST** (`const _: () = assert!(core::mem::size_of::<Channel>() == 0)` at `c_ares.rs:741`) — relies on `&mut Channel` carrying no aliasing constraint because it covers zero bytes; if Channel ever gains a non-ZST field, every `safe fn(&mut Channel)` signature must revert. `ChannelContainer::on_dns_socket_state(&self, …)` uses **R-2**: shared receiver + interior mutability (`UnsafeCell`/`JsCell`/`Cell`) to defuse SB protector UB across re-entrant `Channel::process` | **best-in-section**: the `&mut Channel` ZST trick is one of the most load-bearing static-assertions in the codebase; the `on_sock_state<C>` trampoline takes `&*ctx.cast_const().cast::<C>()` (shared) — not `&mut` — and routes mutation through `Cell`/`JsCell` |
| **libuv callbacks** | **~25 typedefs in `src/libuv_sys/libuv.rs:310-346`** + many concrete instantiations | `Option<unsafe extern "C" fn(*mut uv_handle_t)>`, `uv_alloc_cb`, `uv_read_cb`, `uv_write_cb`, `uv_connect_cb`, `uv_close_cb`, `uv_timer_cb`, `uv_async_cb`, `uv_poll_cb`, `uv_signal_cb`, `uv_fs_cb`, `uv_getaddrinfo_cb`, `uv_work_cb`, `uv_after_work_cb`, `uv_random_cb`, `uv_thread_cb`, `uv_fs_event_cb`, `uv_fs_poll_cb`, `uv_udp_send_cb`, `uv_udp_recv_cb`, `uv_walk_cb` | All take `*mut uv_handle_t` (or subtype `*mut uv_X_t`) — the `data` field on the handle is the user-pointer-out-and-back. Re-entry is the libuv default: the close callback (`uv_close_cb`) fires from inside the next loop turn but `on_dns_poll_uv → Channel::process → us_internal_dns_callback` can re-enter the handle owner. Windows DNS path (`dns.rs:4694-4732`) demonstrates the canonical bracket: `ref_scope` keeps owner alive across `Channel::process` re-entry | **mature**: bracketing via `Resolver::ref_scope(parent) → ResolverRefGuard` is documented at `dns.rs:4694-4732`; the `on_close_uv` body explicitly receives `*mut` and never forms `&mut Resolver` |
| **libuws WebSocket trampolines** | **7** (`uws_sys/WebSocket.rs:587-720` — `on_open/message/drain/ping/pong/close/upgrade`) | `pub extern "C" fn on_X(raw_ws: *mut RawWebSocket, …)`; coerce to `Option<unsafe extern "C" fn>` field type in WebSocketBehavior without per-thunk `unsafe` | Forms `&*this` (shared) — never `&mut`. The inherent `on_*` on Bun's `ServerWebSocket` also take `&self`; SAFETY comment explicitly notes "the re-entrant JS dispatch never stacks a noalias `&mut ServerWebSocket`" | **mature**: all bodies use `unsafe { &*this }` shared reborrow + interior mutability |
| **napi_async_work + napi_finalize cluster** | **8** (Section J, `napi_body.rs:2378, 2437, 2485, 2502, 2715, 2721, 2887`) | `napi_async_complete_callback = extern "C" fn(napi_env, napi_status, *mut c_void)`; `napi_finalize = Option<NapiFinalizeFunction>`; `napi_threadsafe_function_call_js` | Finalizers (`napi_add_finalizer`, `napi_create_external`, `napi_remove_wrap`, `napi_wrap`) all take a `napi_finalize` + `*mut c_void` data hint. Bodies dispatch through `NapiFinalizerTask: Taskable` (queued on main JS thread). **Phase-2 open**: verify the queued task cannot observe a freed `napi_env` (env's deinit must drain the task queue) | **partially mature**: dispatch is queued (good); env-lifetime-vs-queued-finalizer interleaving not yet proven |
| **uws/h3 quic callbacks** | **8** (`uws_sys/h3.rs`, `uws_sys/quic/Context.rs:16`) | `pub extern "C" fn h3_on_*(*mut h3_handle_t, …)`, `on_quic_*(*mut quic_socket_t, …)` | Follows uSockets `RawPtrHandler` shape; `WebSocketUpgradeClient` houses `define_*_callback!` thunks (`$connect`, `$cancel`, `$memory_cost` at `:2147-2210`) that uniformly take `*mut HTTPClient<$ssl>` | **mature** |
| **TinyCC FFI / JIT callbacks** | **49 extern "C"** + 14 DOMJIT readers (Section J, `runtime/ffi/`) | `unsafe extern "C" fn JIT_call(callee: *const c_void, args: …)`, plus 12 `unsafe extern "C" fn read_unaligned_at_*` for DOMJIT fast-path readers with `callconv(jsc.conv)` | JIT W^X: `dangerously_run_without_jit_protections(func)` toggles `pthread_jit_write_protect_np(false)` on aarch64-macOS, paired with `scopeguard::defer!` for re-enable. `JSTypedArrayBytesDeallocator` deallocator-from-`usize` transmute is the hostile-input bottleneck (`FFIObject.rs:24-33`) | **mature** (NPO contract + scopeguard) but **hostile-input-sensitive**: a bad `usize` from JS-land crashes when JSC invokes it — Rust-sound, not user-friendly |
| **TLS / BoringSSL callbacks** | **~5** (Section Q, `src/uws/lib.rs:1146-1150`, BoringSSL X509 verify) | `extern "C" fn always_continue_verify(_, *mut X509_STORE_CTX) -> c_int`, plus HMAC/EVP allocation hooks | Pure read-only or stateless; no Rust state re-entered | **mature** |
| **link-time crate-cycle stubs** | **~10** (`Bun__addrinfo_registerQuic`, `__bun_dns_prefetch`, `Bun__addrinfo_set/cancel/get/freeRequest`) | `#[unsafe(no_mangle)] pub extern "C" fn` with link-time symbol resolution to avoid `bun_install → bun_runtime` cycles | Pure thin shims over `us_*` wrappers; no new aliasing surface | **mature** |
| **plugin / `JSBundlerPlugin` callbacks** | **4 wrappers** + 4 raw `bv2_mut`/`bv2_plugin` accessors (`runtime/api/JSBundler.rs:1387-1812`; `bundler/bundle_v2.rs:1216-1391`) | Plugin-supplied `onResolve`/`onLoad` re-enter `BundleV2` from the JS thread via `enqueue_on_js_loop_for_plugins(task)` and the JS-thread trampoline runs `unsafe { &mut *self.bv2 }` | `bv2: *mut BundleV2<'static>` is a raw backref; `&mut BundleV2` is reborrowed in `run_on_js_thread` while the bundler thread holds its own borrow. Canonical registry owner is EXP-044 (same shape class as EXP-010 but on the bundler root) | **CONFIRMED_UB via EXP-044**: the centralised `bv2_mut()`/`bv2_plugin()` helpers (F-A-7 in Bucket 1) document "single JS thread + disjoint heap" but the returned `&'a mut` lifetime is **caller-chosen**, so two callers within the same plugin frame can collide |
| **dispatch.rs POSIX io_poll arms** | **42 fs-op arms** via `for_each_fs_async_op!` x-macro + 4 `from_field_ptr!` sites at `dispatch.rs:794,799,823,828` | `cast!` macro hides the `*mut Task → *mut ReadFile`/`*mut WriteFile` cast; the io_poll arms form `&mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll)` from a POSIX epoll/kqueue raw `*mut Poll` callback | F-A-12 source audit: the aliasing claim is demoted because the registration-time `&mut Poll` is short-lived and no Rust reference is retained by the event loop. The remaining concern is the pointer→integer→pointer pack in `Pollable`, tracked as F-P-9. | **REVIEWED** for aliasing; remaining issue is a **DEFERRED** strict-provenance gate via F-P-9 |

---

## EXP-012 fix-model — anatomy + propagation status

The canonical Bucket-21 mitigation, as applied to
`WebSocketUpgradeClient::cancel`:

```rust
/// # Safety
/// `this` must point to a live `Self`. Takes `*mut Self` (not `&mut self`)
/// because `tcp.close()` synchronously dispatches `handle_close` from the
/// socket userdata pointer, which would alias a `&mut self` argument; and
/// the trailing `deref` may free `this`, which would violate a `&mut self`
/// argument protector.
pub unsafe fn cancel(this: *mut Self) {
    let this = unsafe { ThisPtr::new(this) };
    // short-lived `&mut` for clear_data; ends before any reentrant call.
    unsafe { (*this.as_ptr()).clear_data() };

    // Bumps the intrusive refcount; derefs on Drop (after `tcp.close`
    // below) which may free `this` — no `&`/`&mut Self` is live at that point.
    let _guard = this.ref_guard();

    if unsafe { (*this.as_ptr()).outgoing_websocket.take().is_some() } {
        unsafe { Self::deref(this.as_ptr()) };
    }

    let tcp = this.tcp;   // copy out before close
    if SSL { tcp.close(uws::CloseCode::Normal); }
    else   { tcp.close(uws::CloseCode::Failure); }
    // `_guard` drops here, balancing the ref above. May free `this`.
}
```

The four required ingredients:

1. **`this: *mut Self`** (not `&mut self`) — so no stacked-borrows
   argument-protector tag is created.
2. **`ThisPtr::new(this)`** wrapper that exposes `as_ptr()` for raw
   reads and is `Copy` for easy threading through the body.
3. **`ref_guard` RAII** — bumps the intrusive refcount on construction
   and decs on Drop, so a re-entrant deref-chain that hits zero is
   delayed until the bracketed region exits.
4. **No `&mut` spans any FFI call that may re-enter** — every borrow is
   single-expression and brackets exactly the field touch it needs.

### Propagation status (workspace-wide)

| consumer | files | sites | model applied? | gaps |
|---|---|---:|---|---|
| `WebSocketUpgradeClient` (Section Q) | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-1761` | 17 callbacks (`cancel`, `handle_close`, `handle_handshake`, `handle_open`, `handle_data`, `handle_decrypted_data`, `handle_end`, `handle_writable`, `handle_timeout`, `handle_connect_error`, `fail`, `dispatch_abrupt_close`, `define_*_callback!`-stamped 3) | **YES — full discipline** | none |
| `WebSocketProxyTunnel` | `src/http_jsc/websocket_client/WebSocketProxyTunnel.rs` | 4 | **YES** | none |
| `HTTPClient` (websocket_client.rs) | `src/http_jsc/websocket_client.rs` | 6 | **YES** | none |
| `ClientSession` (h2_client) | `src/http/h2_client/ClientSession.rs:194-767` | 6 (`SessionRefGuard` via `ref_scope`) | **YES** | none |
| `ProxyTunnel` | `src/http/ProxyTunnel.rs:201-775` | 5 (`ScopedRef` via `ref_scope`) | **PARTIAL** — callbacks use the correct raw-owner/disjoint-field pattern, but stale receiver wrappers remain | EXP-101/102/103 |
| `PostgresSQLQuery` | `src/sql_jsc/postgres/PostgresSQLQuery.rs:157-315` | 4 | **YES** | none |
| `MySQLConnection` / `MySQLRequestQueue` / `JSMySQLQuery` / `JSMySQLConnection` | `src/sql_jsc/mysql/*.rs` | 7 | **YES** | none |
| `Subprocess` (`spawn/process.rs`) | `src/spawn/process.rs`, `src/spawn/static_pipe_writer.rs` | 8 | **YES** | none |
| `Resolver` (dns_jsc) | `src/runtime/dns_jsc/dns.rs:3648-3956` | 19 (`ResolverRefGuard` via `ref_scope`) | **YES** — best-in-section R-2 (POSIX `on_dns_poll` body explicitly cites the ASM-verified miscompile that needed `black_box` laundering when receiver was `&mut self`) | none |
| `JSValkeyClient` | `src/runtime/valkey_jsc/js_valkey.rs:474` | 3 (`client_mut(&self) → &mut ValkeyClient`) | **YES** — R-2; per-call fresh `&mut` to disjoint payload | none |
| `JSBundleCompletionTask` | `src/runtime/api/js_bundle_completion_task.rs` | 1 | **YES** | none |
| `S3MultiPart` / `S3Client` | `src/runtime/webcore/s3/{multipart, client}.rs`, `src/runtime/webcore/S3Client.rs` | 6 | **YES** | none |
| `HTMLRewriter` | `src/runtime/api/html_rewriter.rs` | 2 | **YES** | none |
| `Cron` | `src/runtime/api/cron.rs` (30 `unsafe fn(this: *mut Self)` per Section B notes) | 25 | **YES** — R-2 dominant | none |
| `SubprocessPipeReader` | `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs` | 2 | **YES** | none |
| `Server`/`UserRoute`/`ServePlugins` (Section F) | `src/runtime/server/server_body.rs` (canonical EXP-012-shape upgrade at `:3375`) | ~30 callback bodies | **YES** | F notes flag `RequestContext::as_response()` (line 321) and `NativePromiseContext::take` (line 266) as `&'static mut`-returning helpers. Codex follow-up demotes this from EXP-025-equivalent latent UB to hardening: `as_response` is already `unsafe fn`, and `take` is private-to-file with immediate `RequestContextRef` scoping at reviewed call sites. |
| `HMRSocket` | `src/runtime/bake/DevServer/ErrorReportRequest.rs` etc. | 1 | **YES** | none |
| `FileResponseStream` | `src/runtime/server/FileResponseStream.rs` | 2 | **YES** | none |
| `H2FrameParser` | `src/runtime/api/bun/h2_frame_parser.rs` | 1 (`ref_guard`) | **YES** | none |
| `FsStatWatcher` | `src/runtime/node/node_fs_stat_watcher.rs` | 1 | **YES** | none |
| `Socket` (`runtime/socket/`) | `src/runtime/socket/{socket_body, mod, Handlers, WindowsNamedPipe, WindowsNamedPipeContext, Listener, uws_handlers}.rs` | ~50 (via `RawPtrHandler<T>` adapter that mechanically forces `unsafe fn on_*(*mut Self, …)`) | **YES** | none |
| `FileSink` (`runtime/webcore/`) | `src/runtime/webcore/FileSink.rs:232-266` (`bun_io::impl_streaming_writer_parent!` with `borrow = ptr`); `:463-531` (`on_write` can re-enter `writer.with_mut`) | 4 parent callbacks + writer completion callbacks | **PARTIAL** — parent `borrow = ptr` is correct, but writer completion methods still enter parent callbacks through protected `&mut self` receivers | **EXP-106 CONFIRMED_UB** |
| `WindowsNamedPipe` (`runtime/socket/`) | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; `:1432-1445` (`impl_streaming_writer_parent!` with `borrow = mut`) | 4 streaming-writer callbacks + SSLWrapper-driving `&mut self` entries | **NO — representative SSLWrapper receiver paths confirmed under EXP-104; streaming-writer `borrow = mut` remains same-family hardening.** The `WRAPPER_BUSY` guard solves wrapper-drop/UAF, but not the protected whole-struct receiver held while calling `SSLWrapper`. Generated `#[uws_callback]` exports are one entry source; internal read/start paths have the same receiver shape. |
| `timer::All` | `src/runtime/timer/mod.rs:897, 1016` | 2 sigs (`get_timeout(&mut self, …)`, `drain_timers(&mut self, vm)`) | **NO — `&mut self` receiver still present** despite `TODO(b2)` at lines 908 and 1029. The body discipline is good (raw conversion inside, no local `&mut all` held across `fire()`), but the call-site auto-ref produces a protected `&mut All` tag for the frame | **EXP-026 CONFIRMED_UB** |
| `BundleV2` (plugin path) | `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/api/JSBundler.rs:1387-1405` | 4 reborrow sites + 2 centralised helpers (`bv2_mut`, `bv2_plugin`) | **NO — `&mut *self.bv2` reborrow + caller-chosen lifetime** | **EXP-044 CONFIRMED_UB** |
| `LinkerContext` (parallel callbacks) | `src/bundler/{LinkerContext.rs:1657, linker_context/*}.rs` | 5-site cluster (B-1..B-5) | **NO — `&mut LinkerContext` aliased across worker threads** | **EXP-010 CONFIRMED_UB** |
| `dispatch.rs` io callbacks (Section L) | `src/runtime/dispatch.rs:794, 799, 823, 828` | 4 (`&mut *bun_core::from_field_ptr!(ReadFile/WriteFile, io_poll, poll)`) | **REVIEWED — raw POSIX io_poll callback; no retained registration borrow** | **demoted for aliasing; strict-provenance tracked by F-P-9** |
| `DirectoryWatchStore::owner` | `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81` | 1 | **NO in draft type — `from_field_ptr!` returns `&mut DevServer`** | **EXP-028 NO_EVIDENCE for current production source**: canonical `dev_server::DirectoryWatchStore` uses raw parent recovery and no draft-type call sites were found |

**Summary of fix-model propagation (current as of 2026-05-16):** most
consumers fully apply the EXP-012 raw-pointer/ref-guard model. Four
high-priority holes are now confirmed, not merely open: `timer::All`
(EXP-026), `BundleV2` plugin callbacks (EXP-044), and `LinkerContext`
parallel callbacks (EXP-010), plus the four stale `ProxyTunnel` receiver
wrappers grouped as EXP-101/102/103, plus the `WindowsNamedPipe` SSLWrapper
receiver path (EXP-104), plus the `PipeWriter` / `FileSink` writer-completion
parent-callback re-entry path (EXP-106). `WindowsNamedPipe`'s streaming-writer `borrow = mut`
adapter remains a follow-up hardening sibling, but the direct SSLWrapper export
gap is now confirmed rather than merely suspicious. The old `dispatch.rs` aliasing concern is reviewed/demoted to
strict-provenance tracking, and the `DirectoryWatchStore` draft-type claim is
EXP-028 / NO_EVIDENCE for current production source.

---

## New Bucket-21 findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | draft-experiment-sketch (<=10 lines) |
|---|---|---|---|---|
| F-21-1 | `src/runtime/napi/napi_body.rs:2461-2870` (`ThreadSafeFunction` struct + `dispatch_one`/`release`/`call`) | CONFIRMED_UB via EXP-060 | 21 + 7 + 8 | The exported handle `napi_threadsafe_function = *mut ThreadSafeFunction` is constructed via `bun_core::heap::into_raw(Box::new(init))` and returned to addon code on **any** thread; addon's `napi_call_threadsafe_function` runs from non-JS threads. Later EXP-060 narrowed the bug from a broad CAS-race suspicion to the concrete C-ABI raw-handle defect: exported wrappers mint overlapping `&mut ThreadSafeFunction` from the same raw handle before the internal mutex is taken. Keep CAS/teardown interleavings as follow-up hardening under the same cluster, not as the primary proof. |
| F-21-2 | `src/runtime/socket/WindowsNamedPipe.rs:1432-1445` (`impl_streaming_writer_parent!` with `borrow = mut`) | REVIEWED-SUBSUMED / HARDENING | 21 + 1 | Only `borrow = mut` consumer of `impl_streaming_writer_parent!` (the other consumer, `FileSink`, uses `borrow = ptr`). Macro emits `unsafe { &mut *this }` in every `on_write/on_error/on_ready/on_close` trampoline; SAFETY claim is "single-threaded named pipe ext, nothing re-enters" but Section E flagged a `black_box(from_mut(self))` aliasing-launder workaround in `close`/`shutdown` (Bucket-1 coverage gap), suggesting the shape is fragile. Current registry keeps this under EXP-070's borrow-mode linter/remediation vehicle, not as an unresolved live-UB hypothesis. Should migrate to `borrow = ptr` as hardening / EXP-012 propagation. |
| F-21-3 | `src/cares_sys/c_ares.rs:741` (`const _: () = assert!(core::mem::size_of::<Channel>() == 0)`) | DEFENSIBLE_BUT_LOAD_BEARING | 21 + 11 | The entire c-ares re-entrancy story rests on `Channel` being a ZST so that `safe fn(&mut Channel)` carries no aliasing constraint. If Channel ever gains a non-ZST field (e.g. a Rust-side cache), every `safe fn` signature on Channel must revert to `unsafe fn(*mut Channel)`. The static-assertion catches this at compile time, but the auditor must know the assertion exists. Recommendation: **promote to a registered EXP** to ensure the discipline survives across refactors. |
| F-21-4 | `src/runtime/napi/napi_body.rs:2378, 2437, 2485` (`napi_finalize` cluster) | FOLLOW-UP-HARDENING | 21 + 8 + 13 | Finalizers are queued through `NapiFinalizerTask: Taskable` onto the main JS thread; the queued task carries a `*mut NapiEnv` and a `finalize_hint: *mut c_void`. Follow-up: verify the queued task cannot observe a freed `napi_env` (env's deinit must drain or invalidate the task queue before reclaiming). Reproducer idea: addon registers a finalizer; addon's owning `NapiEnv` is torn down on a worker exit; finalizer dispatch races env teardown. This is not a current registry `OPEN` entry. |
| F-21-5 | `src/runtime/api/JSBundler.rs:1387-1405` (`bv2_mut`, `bv2_plugin`) | CONFIRMED_UB via EXP-044 | 21 + 1 | Two centralised helpers each do `unsafe { &mut *bv2 }` with caller-chosen lifetime `'a`. Re-entrant plugin chain (`on_resolve_async` and `on_load_async` are both reached from the JS-thread trampoline) can call `bv2_mut(self.bv2)` twice in the same frame and produce two **simultaneously-live** `&mut BundleV2`. Same Tree-Borrows shape as EXP-010 but on the bundler root; canonical registry owner is EXP-044, not the historical EXP-030 placeholder. |
| F-21-6 | `src/runtime/dispatch.rs:794, 799, 823, 828` (POSIX io_poll → `&mut *from_field_ptr!(ReadFile/WriteFile, io_poll, poll)`) | CONTRACTUAL-BUT-DEFENSIBLE | 21 + 1 | Source audit demotes the aliasing claim: this is not libuv, the callback receives a raw `*mut Poll` from epoll/kqueue, and the registration-time `&mut Poll` is not retained. `ReadFile::on_ready` / `WriteFile::on_ready` enqueue workpool tasks and do not synchronously call JS while an io_poll borrow is live. Keep as a small raw-pointer conversion site; track strict-provenance separately at F-P-9. |
| F-21-7 | `src/runtime/jsc_hooks.rs:152-157` (`timer_all_mut() -> &'static mut timer::All`) | CONFIRMED_UB (EXP-026 root) | 21 + 1 + 15 | Lone safe accessor synthesising a `&'static mut` from a thread-local raw pointer. Trusts callers not to span re-entry **and** not to be themselves fields of `All`. The hazard surfaces via `All::drain_timers(&mut self)` whose call-site auto-ref creates the protected `&mut All` argument. Already captured by EXP-026; cross-link here so Bucket 21's "things to fix" list is complete. |
| F-21-8 | `src/runtime/server/RequestContext.rs:321-323` (`as_response(value) -> Option<&'static mut Response>`) and `:266` (`NativePromiseContext::take`) | CONTRACTUAL-BUT-DEFENSIBLE | 21 + 15 | Two `&'static mut`-returning helpers used inside uws callback bodies. Follow-up source audit: `as_response` is `unsafe fn` with a two-part safety contract (sole `&mut Response`, GC root), and `NativePromiseContext::take` is private-to-file; the underlying cell take nulls/transfers the ref and the reviewed call sites immediately install `RequestContextRef`. Keep as a docs/hardening watchlist, not a live UB EXP. |
| F-21-9 | `src/uws_sys/vtable.rs:237` (`fn ext(s: *mut us_socket_t) -> &'static mut H::Ext`) | DEFENSIBLE_BUT_LOAD_BEARING | 21 + 1 | The uSockets trampoline materialises a `&'static mut H::Ext` per upcall and "lies with 'static because the borrow never escapes the handler call." Sound iff `H::on_*` never re-enters a uSockets function that fires another callback on the same socket; the `RawPtrHandler<T>` adapter exists precisely to give consumers an escape hatch when this is not true. This is already registered under EXP-070 (borrow-mode annotation/linter vehicle), so do not create a duplicate EXP. |
| F-21-10 | `src/http/ProxyTunnel.rs:707-711,714-749,752-765,768-775` (`shutdown(&mut self)`, `on_writable(&mut self)`, `receive(&mut self, ...)`, `write(&mut self, buf)`) | CONFIRMED_UB via EXP-101/102/103 | 21 + 1 + 15 | ProxyTunnel's callback bodies use the right raw-owner / disjoint-field accessors, but four live entry methods still call `SSLWrapper` while a whole-struct receiver borrow is protected. EXP-101 covers shutdown callers; EXP-102 covers proxy body/header write callers; EXP-103 covers `on_writable` and `receive` callers and specifically disproves the local "raw pointer captured first" comment as a Tree-Borrows fix. Route all four through raw-owner entry points. |
| F-21-11 | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; receiver thunk `src/jsc_macros/lib.rs:828-843` | CONFIRMED_UB via EXP-104 | 21 + 1 + 15 | `WindowsNamedPipe` has callback-driving `&mut self` entries that call `SSLWrapper`; generated `#[uws_callback]` exports create the protected receiver through the macro, while internal receive/start paths have the same whole-struct receiver shape. EXP-104 proves representative `flush` and receive paths fail under Tree Borrows when `SSLWrapper` re-enters through `ssl_write` / `ssl_on_close`; raw-owner controls pass. Keep `WRAPPER_BUSY`, but change the entry shape to raw-owner. |
| F-21-12 | `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185`; `src/runtime/webcore/FileSink.rs:463-531` | CONFIRMED_UB via EXP-106 | 21 + 1 + 15 | `PipeWriter` completion methods call `Parent::on_write` while their `&mut self` receiver is live. `FileSink::on_write` can run JS/microtasks and re-enter the same intrusive writer via `writer.with_mut(|w| w.end()/close())`. `black_box(ptr::from_mut(self))` reloads fields but does not remove the receiver protector; EXP-106 proves the bad path and raw-owner control. |

---

## Recommendation: which callbacks need the EXP-012 fix model propagated

Ranked by combined (re-entry depth × `*mut`-not-applied probability):

1. **EXP-026 fix — `timer::All::{drain_timers, get_timeout}`** flip
   receiver to `this: *mut Self`. In-source `TODO(b2)` at
   `src/runtime/timer/mod.rs:908, 1029` already documents this. The
   `WTFTimer__fire → update/remove` re-entry path is the most-trodden
   re-entry surface in the runtime (every JS `setTimeout` schedules
   a touch) and has a Tree-Borrows witness from EXP-026. **Highest
   ROI — single signature change closes a confirmed-UB shape.**

2. **EXP-044 fix — `BundleV2::Resolve/Load::run_on_js_thread`**
   migrate `unsafe { &mut *self.bv2 }` to `*mut BundleV2` discipline
   + a `BackRef`-based safe accessor mirroring `parse_task_mut(&mut
   self)` pattern at `bundle_v2.rs:1337-1341`. The centralised
   `bv2_mut`/`bv2_plugin` helpers at `JSBundler.rs:1387-1405` are
   the wrong abstraction (lifetime is caller-chosen). **High ROI —
   single concentrated cluster, plugin path is user-visible.**

3. **EXP-060 fix — `napi::ThreadSafeFunction` raw-handle entrypoints**
   stop exported C wrappers from minting overlapping `&mut
   ThreadSafeFunction` from the same `napi_threadsafe_function` raw handle
   before taking the internal mutex. After that fix, loom/shuttle model the
   `dispatch_state` CAS dance at `napi_body.rs:2604-2680` and the
   `closing`/`aborted` interaction in `release()` as follow-up hardening.

Honourable mentions (lower ROI, mechanical fixes):
- **F-21-2** — `WindowsNamedPipe` migrate to `borrow = ptr`
- **F-21-6** — reviewed/demoted for aliasing; strict-provenance is F-P-9
- **F-21-9** — keep the `vtable.rs:237` `&'static mut H::Ext`
  contract covered by EXP-070's borrow-mode annotation/linter; avoid a duplicate
  registry entry.

---

## Deliverable summary

**Total FFI-callback sites:** workspace-wide upcall surface is **~600
distinct Rust entry points** (379 `pub extern "C" fn` + 366 `unsafe
extern "C" fn` − pure FFI thunks). Of these, **337 sites (~56 %) use
the `*mut Self` discipline**; the remainder are pure-FFI shims or use
shared (`&*this`) borrows that don't form aliasing-creating `&mut`.
`bun_ptr::ThisPtr`/`ref_guard`/`ref_scope`/`ScopedRef` brackets appear
**215 times across 29 files**, confirming the EXP-012 fix model is the
dominant maintainer-applied mitigation.

**Re-entry contract status:** most callback consumers fully apply the
EXP-012 model (every `cancel`/`destroy`/`fail` path,
`Resolver`/`ClientSession`/most SQL drivers/all subprocess writers, plus
WebSocketProxyTunnel as a clean SSLWrapper contrast). Four holes are confirmed and owned by registry entries:
`timer::All` receivers stuck on `&mut self` despite `TODO(b2)` (EXP-026),
`BundleV2` plugin path `&mut *self.bv2` cross-thread reborrow (EXP-044), and
N-API `ThreadSafeFunction` raw-handle entrypoints minting overlapping `&mut`
before locking (EXP-060), and the SSLWrapper receiver family
(EXP-100/101/102/103/104). `WindowsNamedPipe` streaming-writer `borrow = mut`
remains a follow-up hardening sibling. The c-ares family is sound but rests on the
**load-bearing `const _: () = assert!(size_of::<Channel>() == 0)`** invariant
(F-21-3), which should be kept as a regression guard rather than conflated with
a live bug.

**Top 3 callbacks needing fix-model propagation:**

1. **`timer::All::{drain_timers, get_timeout}`** — flip `&mut self`
   → `this: *mut Self` (EXP-026, in-source `TODO(b2)`). Highest ROI:
   single signature change closes a Tree-Borrows-confirmed UB shape
   on the runtime's hottest re-entry path.

2. **`BundleV2::Resolve/Load::run_on_js_thread` + the centralised
   `bv2_mut`/`bv2_plugin` helpers** (EXP-044). Cross-thread `&mut
   BundleV2` reborrow with caller-chosen lifetime; plugin chain
   re-entry can produce two simultaneously-live `&mut`.

3. **`napi::ThreadSafeFunction` raw-handle protocol**
   (EXP-060). Not strictly an EXP-012 propagation but the same family:
   C-ABI exported wrappers receive `napi_threadsafe_function = *mut
   ThreadSafeFunction` and must not materialise overlapping `&mut` handles
   before synchronization.
