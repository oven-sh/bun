# Phase-1 Inventory — Section F: runtime-server-and-jsc-hooks

Run: `2026-05-15-exhaustive` · Sub-agent: unsafe-surface-mapper-F · Section paths: `src/runtime/server/`, `src/runtime/dispatch.rs`, `src/runtime/jsc_hooks.rs`, `src/runtime/ipc_host.rs`, `src/runtime/hw_exports.rs`

## Totals

| metric | server/ | dispatch.rs | jsc_hooks.rs | ipc_host.rs | hw_exports.rs | TOTAL |
|---|---:|---:|---:|---:|---:|---:|
| unsafe blocks (`unsafe {`) | 334 | 59 | 272 | 5 | 39 | **709** |
| `unsafe fn` declarations | 43 | 7 | 31 | 0 | 13 | **94** |
| `unsafe extern` blocks | 3 | 0 | 1 | 1 | 0 | **5** |
| `// SAFETY:` comments | 383 | 57 | 222 | 5 | 33 | **700** |
| `extern "C"` / `#[no_mangle]` sites | 40 | 9 | 8 | 2 | 18 | **77** |
| transmute/set_len/assume_init/UnsafeCell/unreachable_unchecked | 5 | 3 | 8 | 0 | 0 | **16** |
| `*mut Self` parameter shapes | 90 | 1 | 2 | 0 | 0 | **93** |
| `unsafe impl Send/Sync` | 0 | 0 | 0 | 0 | 0 | **0** |

Surface site count (blocks + unsafe fn + unsafe extern items): **808** vs prior 762 (+46, ~6 %). The growth tracks ongoing Zig→Rust ports landed since the prior audit (server_body.rs, NodeHTTPResponse.rs, RequestContext.rs are all under active port).

Safety-comment coverage: 700 / 808 ≈ **86 %**. Coverage is uneven by file — ipc_host (100 %), dispatch (87 %), jsc_hooks (~75 % — many `unsafe { (*vm).field }` raw-place reads share one upstream SAFETY block), server/ (~80 % including the densest macro-generated R-2 / `*mut Self` callback cluster).

## Per-row table (one row per file / cluster of unsafe surface)

| file | kind | site_count | dominant_bucket | macro_generated | safety_quality | notes |
|---|---|---:|---|---|---|---|
| `src/runtime/jsc_hooks.rs` | high-tier VM/Loader hook bodies | 304 (272 blk + 31 fn + 1 ext) | 1 Aliasing-callback, 4 Provenance, 21 FFI-callback aliasing | source-direct, plus `link_impl_VmLoaderCtx!` (1 invocation, ~14 fn-ptr arms) | strong — every `unsafe fn` carries a `# Safety` doc; every raw-place deref of `(*vm)` / `(*state)` has an inline `// SAFETY:` referencing the §Forbidden aliased-&mut rule | EXP-012-style discipline is explicit: `runtime_state()` returns `*mut`, `auto_tick` dereferences per-field, `WTFTimer`/`drain_timers` paths warn against `&mut timer` aliasing on re-entry. `thread_local! RUNTIME_STATE: Cell<*mut RuntimeState>` — single owner per JS thread. |
| `src/runtime/server/mod.rs` | server entry, FFI thunks, pools | ~70 unsafe surface | 1 Aliasing-callback, 4 Provenance, 21 FFI | macro_rules `impl_server_pools!((false,false),(true,false),(false,true),(true,true))` — 4 monomorphizations, each one `thread_local!{ static POOL: Cell<*mut Pool> }` | strong — `Drop for NewServer`, `DetachRequestOnDrop` carry contracts; FFI extern blocks marked `safe fn` where the safety condition is module-private | Generic statics workaround: per-(SSL,DEBUG) `thread_local!` block. THREAD-SAFETY comment at line 2943 explicitly forbids process-global. |
| `src/runtime/server/server_body.rs` | UserRoute, on_request, on_web_socket_upgrade, ServePlugins | ~180 unsafe surface | 1 Aliasing-callback, 14 Pool/MaybeUninit, 21 FFI | source-direct | strong — `on_web_socket_upgrade` (line 3375) is the canonical EXP-012-shape upgrade: `*mut Self` receiver, raw cast on `id == 1` branch (UserRoute), reborrow as `&mut *self_ptr` only when `id == 0` and only after confirming the dispatched body cannot free `self` | `MaybeUninit`-token pool slot `claim()` + `create_in()` + `assume_init()` (lines 3140-3170) is the hottest allocation path and is panic-safe (`HiveSlot::drop` releases the slot if `create_in` panics). |
| `src/runtime/server/RequestContext.rs` | per-request lifecycle, HiveSlot ctx, NativePromiseContext | ~130 unsafe surface | 1 Aliasing, 4 Provenance | source-direct | mixed — `as_response()` (line 321) returns `&'static mut Response` with a documented two-part safety contract that relies on caller discipline | The `&'static mut` return is the most caller-fragile shape in F; spelled-out contract requires no other `&mut Response`, plus value kept GC-rooted. |
| `src/runtime/server/NodeHTTPResponse.rs` | uws AnyResponse callbacks, AnyRefCounted impl | ~90 unsafe surface | 21 FFI-callback aliasing | hand-written `bun_ptr::AnyRefCounted` (5 `unsafe fn` arms taking `*mut Self` / `*const Self`) | strong | R-2 pattern: `on_data_shim`, `on_timeout_shim` reborrow `&*const Self` (shared), not `&mut`. AnyRefCounted comment (line 1938) explicitly notes "the existing `&self`-receiver `deref()` above is called from ~10 sites that route through `as_ctx_ptr()`-derived provenance; converting them to `unsafe deref(*mut)` is a separate sweep" — open TODO. |
| `src/runtime/server/ServerWebSocket.rs` | uws WebSocketBehavior trait impl | ~30 unsafe surface | 21 FFI-callback aliasing | trait `WebSocketHandler` impl (6 `unsafe fn` arms: on_open, on_message, on_drain, on_ping, on_pong, on_close) | strong | Every arm reborrows `unsafe { &*this }` (shared). Inherent `on_*` take `&self` — explicit comment "the re-entrant JS dispatch never stacks a `noalias` `&mut ServerWebSocket`". |
| `src/runtime/server/HTMLBundle.rs` | Route ref-counted shared state | ~15 unsafe surface | 4 Provenance, 21 FFI | `bun_ptr::RefCounted` derive | strong | Route comment (line 146) is one of the cleanest R-2 statements in F: "*mut Route is recovered from uws userdata and the JSBundleCompletionTask backref while a prior &Route may still be on the stack — `&mut self` would alias (UB); `&self` + `UnsafeCell` is sound." |
| `src/runtime/server/FileResponseStream.rs` | sendfile/zero-copy stream | ~20 unsafe surface | 21 FFI, 4 Provenance | source-direct | strong | `Drop for FileResponseStream` runs explicit deinit; no FFI re-entry in finalizer path. |
| `src/runtime/server/ServerConfig.rs`, `StaticRoute.rs`, `FileRoute.rs`, `RangeRequest.rs`, `WebSocketServerContext.rs`, `AnyRequestContext.rs`, `HTTPStatusText.rs` | config plumbing, static asset routes | ~40 unsafe surface combined | 4 Provenance, 21 FFI | source-direct | strong | Lower-density, mostly raw-ptr round-trips into uws / JSC bindings. |
| `src/runtime/dispatch.rs` | §Dispatch hot-path Task / FilePoll / Timer match | 66 unsafe surface | 1 Aliasing (tag-keyed pointer cast), 11 Unreachable-unchecked | macro_rules `cast!`, `cast_ptr!`, `compression_arm!`, `run_then_destroy!`, `shell_dispatch!`, `for_each_fs_async_op!` (one big x-macro stamping 42 fs-op arms) | strong — `cast!` macro carries the SAFETY invariant once at the top of `run_task`; per-arm comments link to spec line numbers | One `core::hint::unreachable_unchecked()` (line 393) for the fs-op inner match — guarded by the outer or-pattern proving exhaustiveness. Line 460 explicitly rejects unreachable_unchecked for the `ImmediateObject`/`TimeoutObject` arm because it's a "reachable producer bug, not provable-unreachable." |
| `src/runtime/ipc_host.rs` | IPC host fns (Bun__Process__send, emit_handle_ipc_message) | 6 unsafe surface | 21 FFI-callback aliasing, 4 Provenance | source-direct | strong — 100 % `// SAFETY:` coverage | Smallest file in F. Pattern: `(*ipc).handle_ipc_message(...)` with raw-ptr deref, no `&mut` formed before the FFI call. `unsafe extern "C" { safe fn Process__emitErrorEvent(...) }` — uses the `safe` keyword to discharge precondition. |
| `src/runtime/hw_exports.rs` | handwritten C-ABI exports (VirtualMachine::Bun__*) | 52 unsafe surface | 4 Provenance, 21 FFI | macro `bun_sql_jsc::link_impl_SqlRuntimeHooks!` (1 invocation, 13 fn-ptr arms) | strong — every `unsafe fn` carries `# Safety` doc | Two `pub static __BUN_*_HOOKS` jump tables installed at link time. The static `SqlRuntimeHooks` slot pulls in 13 fn-ptr arms; each does `(*this.cast::<X>()).method()` — same R-2 raw-deref pattern as jsc_hooks. |

## Bucket distribution (UB-TAXONOMY tags)

- **Bucket 1 (Aliasing — Stacked/Tree Borrows)**: dominant. ~90 % of F sites are raw `(*ptr).field` reads/writes deliberately routed through `*mut` to avoid forming `&mut T` across a re-entrant FFI / JS-call boundary. Every site comments on this explicitly.
- **Bucket 4 (Provenance — `Box::from_raw`, casts)**: ~40 sites. Concentrated in `heap::into_raw` / `heap::take` pairings inside `init_runtime_state` / `deinit_runtime_state` / `on_web_socket_upgrade`.
- **Bucket 11 (Unreachable_unchecked)**: 1 site (`dispatch.rs:393`), guarded by exhaustive or-pattern.
- **Bucket 21 (FFI callback aliasing — re-entrancy)**: ~50 sites, all in callbacks routed off uws/uWebSockets, JSC, libuv. Every one uses `*mut Self` receivers + short-lived reborrow.
- **Bucket 6 (Validity — niche / MaybeUninit)**: 14 sites in `server_body.rs` `HiveSlot::claim/assume_init`. Pool path is panic-safe.
- **Bucket 22 (Send/Sync confusion)**: 0 in F. (No `unsafe impl Send`/`Sync` in this section.)

## Macro-generated vs source-direct

- **Source-direct unsafe**: ~95 % of F's unsafe surface — `unsafe { ... }` blocks written inline in human-authored code with paired `// SAFETY:` comments.
- **Macro-generated unsafe**:
  - `bun_ptr::RefCounted` derive on `HTMLBundleRoute`, `NodeHTTPResponse` parent type, `ServerWebSocket` (where applicable) — these emit `unsafe impl RefCount` glue, but the body just touches `Cell<u32>`.
  - `bun_bundler::link_impl_VmLoaderCtx!` (jsc_hooks line 1377) — ~14 fn-ptr arms stamped from a DSL describing raw-place reads off `*const VirtualMachine`.
  - `bun_sql_jsc::link_impl_SqlRuntimeHooks!` (hw_exports line ~245) — 13 fn-ptr arms with the same shape.
  - `impl_server_pools!((false,false),(true,false),(false,true),(true,true))` (mod.rs line 2954) — 4 monomorphizations, each producing one `thread_local!` Pool slot.
  - `for_each_fs_async_op!` x-macro (dispatch.rs) — emits 42 fs-async arms with the `cast!`-macro SAFETY invariant inherited from the enclosing `run_task` body.
- **NOT present in F**: `impl_streaming_writer_parent!` from `src/io/PipeWriter.rs` is not invoked in F itself (it is invoked in webcore/socket sections). The R-2 (`*mut Self` receiver) discipline it encodes is, however, applied by hand throughout server/.

## EXP-012 anchor — status: **RESOLVED for the named cancel path**

See `phase1_notes/F_server_jsc_hooks.md` §EXP-012 for the side-by-side diff. The "WebSocketClient" of the original watchpoint maps in current source to `WebSocketUpgradeClient` (`src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:605`) — outside F but the only WS-client `cancel(this)` path. Its Rust port already uses `*mut Self` + `ThisPtr` + `ref_guard` with no `&mut self` spanning the re-entrant `tcp.close()` / `outgoing_websocket.take()` paths. The Zig sibling (`.zig:421`) is symmetric. The ServerWebSocket / NodeHTTPResponse close paths inside F follow the same discipline (`&self` receivers everywhere; `unsafe { &*this }` shared reborrows in the trait impl). This resolves the seeded EXP-012 hypothesis for the named path; it is **not** a blanket proof that every future close/cancel path in F is safe.
