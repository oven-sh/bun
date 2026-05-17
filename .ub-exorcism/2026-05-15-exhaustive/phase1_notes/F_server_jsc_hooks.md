# Section F: runtime-server-and-jsc-hooks

## Purpose (1 paragraph)

Section F is the Bun.serve concurrency hub plus the JSC-side runtime/loader hook plumbing that wires the high-tier `bun_runtime` crate to the low-tier `bun_jsc` and `bun_event_loop` crates via fn-pointer vtables (`__BUN_RUNTIME_HOOKS`, `__BUN_LOADER_HOOKS`, `__BUN_SQL_RUNTIME_HOOKS`) and `#[no_mangle]` C-ABI thunks. The server subtree (`runtime/server/`) is the HTTP/WebSocket/H3 request-handler surface: monomorphized over `(SSL, DEBUG, H3)` flags, owns per-thread request pools, drives the entire uWebSockets callback graph (on_request, on_data, on_writable, on_aborted, on_websocket_upgrade, on_open, on_message, on_drain, on_close, on_ping, on_pong), and is the largest FFI-callback density in the codebase. `dispatch.rs` is the §Dispatch task-/timer-/poll-arm `match` that LLVM compiles into a jump table for ~96 task variants; `jsc_hooks.rs` provides high-tier bodies for `VirtualMachine::init`/`auto_tick`/`load_preloads`/transpiler/module-loader hooks; `ipc_host.rs` is `process.send()`/IPC; `hw_exports.rs` is handwritten `Bun__*` C-ABI symbols whose bodies need to name `bun_runtime` types but whose link names must be defined from a crate that depends on `bun_jsc`.

## Per-path unsafe-surface tally (vs prior 762)

| path | site_count | dominant_kind | dominant_bucket |
|---|---:|---|---|
| `src/runtime/server/` | 380 | `unsafe { (*ptr).field }` raw-place reads in FFI callbacks; `*mut Self` receivers in `WebSocketHandler` and on_request | 1 (Aliasing-callback) + 21 (FFI re-entry) |
| `src/runtime/dispatch.rs` | 66 | macro-stamped `cast!`/`cast_ptr!` over `Task.ptr` | 1 (Aliasing — tag-keyed cast) + 11 (one `unreachable_unchecked`) |
| `src/runtime/jsc_hooks.rs` | 304 | raw-place `(*vm).x` / `(*state).y` in `auto_tick`/`transpile_file`/`resolve` to avoid forming `&mut VirtualMachine` across re-entrant JS | 1 (Aliasing-callback) + 4 (Provenance — heap::into_raw/take) |
| `src/runtime/ipc_host.rs` | 6 | `(*ipc).handle_ipc_message(...)` | 21 (FFI re-entry) |
| `src/runtime/hw_exports.rs` | 52 | `unsafe fn` thunks emitted by `generate-host-exports.ts`; macro-stamped Sql runtime hook arms | 4 (Provenance) + 21 (FFI) |
| **TOTAL** | **808** | — | — |

Delta vs prior `phase0_partition.json` (762): **+46** (≈ +6 %), tracking ongoing Zig→Rust ports. No site dropped that should still exist; every new site I sampled carries a fresh `// SAFETY:` and spec back-reference.

## WebSocket client cancel anchor (EXP-012)

The EXP-012 hypothesis is that a WebSocket client cancel/close path could re-enter Rust while `&mut self` is live. The cancel paths in Section F are HTTP-response close / WebSocket `on_close`; the actual `cancel(this)` lives just *outside* F in the websocket-upgrade client. Current-source validation falsifies the concrete seeded hypothesis for that path: it is already written in the raw-pointer/refcount-guard style the audit wants.

### `WebSocketUpgradeClient::cancel` — Rust (current-source target of EXP-012)

`src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637`:

```rust
/// # Safety
/// `this` must point to a live `Self`. Takes `*mut Self` (not `&mut self`)
/// because `tcp.close()` synchronously dispatches `handle_close` from the
/// socket userdata pointer, which would alias a `&mut self` argument; and
/// the trailing `deref` may free `this`, which would violate a `&mut self`
/// argument protector.
pub unsafe fn cancel(this: *mut Self) {
    // SAFETY: caller (C++ / uWS) holds a live ref; `this` carries root
    // (userdata) provenance from `heap::alloc`.
    let this = unsafe { ThisPtr::new(this) };
    // SAFETY: short-lived `&mut` for clear_data; ends before any reentrant call.
    unsafe { (*this.as_ptr()).clear_data() };

    // Either of the below two operations - closing the TCP socket or clearing the
    // C++ reference could trigger a deref. Therefore, we need to make sure the
    // `this` pointer is valid until the end of the function. Bumps the intrusive
    // refcount and derefs on Drop (after `tcp.close` below), which may free `this`
    // — no `&`/`&mut Self` is live at that point.
    let _guard = this.ref_guard();

    // The C++ end of the socket is no longer holding a reference to this, so we
    // must clear it.
    // SAFETY: short-lived `&mut` for the field take; ends before any reentrant call.
    if unsafe { (*this.as_ptr()).outgoing_websocket.take().is_some() } {
        // SAFETY: refcount > 1 here (the +1 from `_guard` above).
        unsafe { Self::deref(this.as_ptr()) };
    }

    // Copy `tcp` out so no `&mut Self` spans the close — uSockets fires
    // `handle_close` inline, which derives a fresh `&mut`/`*mut` from
    // userdata.
    let tcp = this.tcp;
    // no need to be .failure we still wanna to send pending SSL buffer + close_notify
    if SSL {
        tcp.close(uws::CloseCode::Normal);
    } else {
        tcp.close(uws::CloseCode::Failure);
    }
    // `_guard` drops here, balancing the ref above. May free `this`.
}
```

### `WebSocketUpgradeClient::cancel` — Zig sibling (original spec)

`src/http_jsc/websocket_client/WebSocketUpgradeClient.zig:421-441`:

```zig
pub fn cancel(this: *HTTPClient) callconv(.c) void {
    this.clearData();

    // Either of the below two operations - closing the TCP socket or clearing the
    // C++ reference could trigger a deref. Therefore, we need to make sure the
    // `this` pointer is valid until the end of the function.
    this.ref();
    defer this.deref();

    // The C++ end of the socket is no longer holding a reference to this, so we
    // must clear it.
    if (this.outgoing_websocket != null) {
        this.outgoing_websocket = null;
        this.deref();
    }

    // no need to be .failure we still wanna to send pending SSL buffer + close_notify
    if (comptime ssl) {
        this.tcp.close(.normal);
    } else {
        this.tcp.close(.failure);
    }
}
```

### Side-by-side analysis

| concern | Zig | Rust |
|---|---|---|
| Argument shape | `this: *HTTPClient` (raw single-element ptr in Zig — no aliasing model) | `this: *mut Self` (raw, explicit; `&mut self` is rejected by the documented contract) |
| Refcount guard around tcp.close + outgoing_websocket.take | `this.ref(); defer this.deref();` | `let _guard = this.ref_guard();` (RAII Drop) |
| Field access during the reentrancy window | `this.outgoing_websocket = null;` (no Stacked-Borrow analog in Zig) | `unsafe { (*this.as_ptr()).outgoing_websocket.take().is_some() }` (raw-place projection; no `&mut Self` formed) |
| `tcp.close()` re-entry into `handle_close` | implicit Zig assumption | spelled out: `let tcp = this.tcp;` then `tcp.close(...)` so the call frame holds no projection of `*this` |
| Final possible-free | `defer this.deref();` | `_guard` drops at end (after `tcp.close`) |

**Verdict: RESOLVED for this named cancel path.** The Rust port is *more* paranoid than the Zig spec: it threads everything through `ThisPtr` and `ref_guard` (a `Drop`-on-end RAII) and uses raw-place projections instead of borrows. The implementation comment at lines 600-604 explicitly cites the EXP-012 hazard ("would violate a `&mut self` argument protector"). Keep the pattern as a watchpoint for future close/cancel paths, but do not count EXP-012 as an open current-source bug unless another path holding `&mut self` across re-entry is identified.

## *mut Self callback pattern enumeration (THIS section's slice of the ~1,610)

- **Total `*mut Self` parameter shapes in F**: 93 (90 in `server/`, 1 in `dispatch.rs`, 2 in `jsc_hooks.rs`).
- **`*mut Self` shapes in `dispatch.rs` and `jsc_hooks.rs`**: thin — these files prefer plain `*mut VirtualMachine` / `*mut RuntimeState` / `*mut Task` because they thread the foreign type, not their own `Self`.
- **Server cluster is the densest**:
  - `WebSocketHandler` trait impl on `ServerWebSocket` (lines 1530-1565): 6 arms `unsafe fn on_open/on_message/on_drain/on_ping/on_pong/on_close(this: *mut Self, ws: AnyWebSocket, ...)`. Every body forms `unsafe { &*this }` (shared reborrow) — explicitly designed so the re-entrant JS dispatch never stacks a `noalias &mut` (R-2 comment line 1531).
  - `AnyRefCounted` impl on `NodeHTTPResponse` (lines 1943-1972): 5 arms `unsafe fn rc_ref(this: *mut Self)`, `rc_deref_with_context`, `rc_has_one_ref(this: *const Self)`, `rc_assert_no_refs`, `rc_debug_data`. Phase-5 correction: `rc_ref` is `Cell<u32>`-only, but `rc_deref_with_context` can hit the zero-ref `deinit` path and free via `heap::take(self.as_ctx_ptr())`; see EXP-056.
  - Inherent `unsafe fn` cluster in `server_body.rs`: `on_web_socket_upgrade(this: *mut Self, ...)` (line 3375), `on_websocket_upgrade` (line 1431), `on_node_http_request_with_upgrade_ctx`, `deref_(this: *mut Self)`, `guard_ref(this: *mut Self)`, `adopt(ptr: *mut ServePlugins)` — every one explicitly documents the re-entry hazard.
  - `DetachRequestOnDrop::new(request_object: *mut crate::webcore::Request)` (mod.rs line 413) — RAII wrapper around a raw owned pointer; safety contract names the keep-alive holder.
  - `as_response(value: JSValue) -> Option<&'static mut Response>` (RequestContext.rs line 321) — **most caller-fragile shape in F**: returns `&'static mut`. The contract spells out that the caller must avoid forming a second `&mut Response` and keep the value GC-rooted. This is the one shape worth a watch-list note for follow-up.

### New shapes not in prior audit A-001 sample

1. **The Rust-side `RuntimeState` thread-local `Cell<*mut RuntimeState>`** (jsc_hooks.rs:102-107) — used to recover per-VM state during `auto_tick` callbacks that arrive with only `*mut VirtualMachine`. The accessor *returns `*mut`* and not `&'static mut` precisely so re-entrant `setTimeout` callbacks cannot mint a second `&mut RuntimeState`. The companion `timer_all_mut() -> &'static mut timer::All` is restricted to callers that are "NOT themselves fields of `All`" — a documented soundness side-condition that depends on caller discipline.
2. **`UnsafeCell`-backed `Route` (HTMLBundle.rs:146-175)** — `Route` is `&self`-only because `*mut Route` is recovered from two distinct uws callback paths (`on_aborted` and `JSBundleCompletionTask` backref) which can be live simultaneously. The R-2 comment at line 146 is exemplary; this exact shape may not be in the prior A-001 sample but is precisely the EXP-012 fix-pattern generalized.
3. **`RacyCell<Option<InternalMsgHolder>> CHILD_SINGLETON`** (referenced from jsc_hooks.rs:1339, defined in node_cluster_binding.rs:35) — JS-thread-only mutable static via `bun_core::RacyCell`. SAFETY comment names the thread-locality invariant.
4. **`MaybeUninit::write` pool slot pattern in `server_body.rs:3140-3170`** — `HiveSlot::claim()` returns an uninitialized token; `Ctx::create_in()` does placement-new through the slot's stable address; `slot.assume_init()` consumes the token. Panic-safety is explicit: `HiveSlot::drop` releases the slot if `create_in` panics, avoiding `RequestContext::drop` running on garbage.

### `impl_streaming_writer_parent!` instances in F

**None.** That macro lives in `src/io/PipeWriter.rs` and is invoked from `bun_io` / `bun_socket` / webcore — not from any F path. The discipline it encodes (borrow=mut / borrow=shared / borrow=ptr) is, however, applied by hand throughout `server/` (`*mut Self` for the cases that can free; `&self` for the cases that only re-enter on shared state).

## unsafe impl Send/Sync audit

| impl Send/Sync | file:line | type fields | sync mechanism |
|---|---|---|---|
| (none) | — | — | — |

**Zero `unsafe impl Send` / `unsafe impl Sync` in Section F.** The Send/Sync UB prior in `phase0_partition.json` for F was forward-looking: F itself does not declare any, but it depends transitively on `bun_jsc` (Strong/Weak handles), `bun_uws` (uWebSockets socket types), `bun_io` (FilePoll), and `bun_event_loop` (Task) — each of those crates has its own Send/Sync impl set audited in their respective sections (K, Q, P).

The closest thing in F is the per-thread discipline:
- `thread_local!` for `RUNTIME_STATE`, `TRANSPILE_PRINTER`, `TRANSPILE_PATH_INTERN`, `POOL` (4 monomorphizations × 2 pools = 8 instantiations), `RequestContext` POOL.
- `static AtomicBool` for one-shot warnings (idletimeout, etc.) — `Ordering::Relaxed`, no synchronization claim beyond "warn once".
- `static FLAG: AtomicBool` and the `RacyCell` mutable singletons are all qualified by comments naming the JS-thread-only invariant.

## Re-entrant FFI callback enumeration

Every uws / JSC callback registered from F has the property "may re-enter Rust while the outer call is on the stack". F's discipline:

| callback site | receiver shape | re-entry contained how |
|---|---|---|
| `ServerWebSocket::on_{open,message,drain,ping,pong,close}` | `unsafe fn (this: *mut Self, ...)` | reborrow as `unsafe { &*this }` (shared); inherent `on_*` takes `&self` |
| `NodeHTTPResponse::on_data_shim`, `on_timeout_shim`, `on_writable_shim` | `*mut NodeHTTPResponse` | reborrow as `&*const` (shared) |
| `Route` (HTMLBundle) callbacks `on_aborted`, plugin completion | `*mut Route` | `&Route` + UnsafeCell interior-mutability |
| `Server::on_web_socket_upgrade(this: *mut Self, ..., id: usize)` | `*mut Self` (typed by `id`-discriminant) | raw cast on `id==1`, reborrow as `&mut *self_ptr` on `id==0` only after confirming no re-entry between the borrow and the dispatch |
| `Server::on_request` host-fn path | `&mut RequestContext` formed AFTER `MaybeUninit::write` and dropped before any JS call | re-entry via `ctx.deinit()` is funneled through the deref-on-drop guard |
| `WebSocketBehavior` C++→Rust trampolines | `*mut Self` | as above |
| `auto_tick` → `timer::All::get_timeout/drain_timers` | raw `*mut RuntimeState` → `&mut (*state).timer` formed once, short-lived | spelled out in jsc_hooks.rs:910-918 |
| IPC `handle_ipc_message` from `emit_handle_ipc_message` | `*mut IPCInstance` / `*mut Subprocess` | raw deref, no `&mut` |
| `cancel`/`fail`/`dispatch_abrupt_close` in WebSocketUpgradeClient (just outside F but exercised by F's WS path) | `*mut Self` + `ThisPtr` + `ref_guard` RAII | see EXP-012 section above |

**Worst-case re-entry depth?** Bounded by stack — there is no fundamental cap. The deepest realistic chain observed: uws on_data → JS handler → `ws.send()` → uws write → potential on_writable callback → JS handler → `ws.close()` → on_close. Each step routes through `*mut Self`, so the re-entry chain compounds *pointers* (which is fine) not borrows (which would compound `noalias`-incompatible references). The discipline is intentional and uniformly applied.

## Notable patterns

1. **Raw-place projection over `&mut` for any field touched by potentially-re-entrant code.** Pattern: `unsafe { (*vm).field }` / `unsafe { ptr::addr_of_mut!((*state).timer) }`. This is the dominant unsafe shape in F and the project-wide solution to EXP-012-class bugs.
2. **`ThisPtr` + `ref_guard` RAII for callbacks that may free `self`.** Imported pattern from `bun_ptr::ref_count`; used at the WebSocketUpgradeClient boundary. The Rust port is materially stricter than the Zig spec.
3. **Documented `&'static mut` returns that depend on caller discipline.** `as_response` (RequestContext.rs:321) and `NativePromiseContext::take` (RequestContext.rs:266) — both spell out the contract, but they are the most fragile shapes in F because borrowck cannot enforce "no other `&mut` is live."
4. **`MaybeUninit` placement-new for pool slots is panic-safe** — `HiveSlot::drop` releases the slot if `create_in` panics, avoiding `RequestContext::drop` on uninit. This is unusually careful.
5. **`unreachable_unchecked` is used surgically** — exactly one site (`dispatch.rs:393`), guarded by an outer or-pattern that proves exhaustiveness, with a sibling site (`dispatch.rs:460`) explicitly *rejecting* it for a producer-bug case. Good discipline.
6. **Macro-generated unsafe is shallow** — F has no `bun_jsc::host_fn!` heavy stamping, no `impl_streaming_writer_parent!` invocations. Most unsafe is source-direct with `// SAFETY:` per block; the four macro-stamped clusters (`for_each_fs_async_op!`, `impl_server_pools!`, `link_impl_VmLoaderCtx!`, `link_impl_SqlRuntimeHooks!`) all carry a single SAFETY proof at the macro-call site that covers every stamped arm.

## Open questions

1. **`as_response()` returning `&'static mut Response`** — relies on the caller never minting a second `&mut Response` for the same JSC cell. Suggest a Miri experiment in Phase 5 that drives two host fns hitting the same Response value to confirm no other code-path forms an aliasing `&mut`.
2. **`timer_all_mut() -> &'static mut timer::All`** — documented soundness side-condition "callers must not be themselves fields of `All`". This is enforced by convention; a refactor that adds a new caller from inside `All` would silently introduce UB. Worth a clippy lint or a marker trait.
3. **`AnyRefCounted` on `NodeHTTPResponse`** — hand-written (not `#[derive]`) because the existing `&self`-receiver `deref()` is called from ~10 sites that route through `as_ctx_ptr()`-derived provenance. Phase-5 correction: the earlier "shared-deref path is sound because `deref()` only touches `Cell`/`JsCell` fields" claim was wrong for the zero-ref path. `deref(&self)` can call `deinit(&self)`, which frees through `heap::take(self.as_ctx_ptr())`; EXP-056's Miri witness confirms that deallocation through shared provenance is UB.
4. **`HiveSlot::claim`/`assume_init` race exposure** — pool is per-thread (`impl_server_pools!` declares `thread_local!`), so no cross-thread race; but a recursive call to `request_pool()` during pool init would re-enter `Pool::new_boxed()` on a null slot. Probably unreachable since init happens at first-request time outside any re-entrancy window, but worth a once-over.
5. **`for_each_fs_async_op!` x-macro maintenance** — 42 entries, and one `unreachable_unchecked` riding on the outer or-pattern being exhaustive. If someone adds an fs-op to one half without the other, the dispatch silently degrades to a release-build UB call. The compile-time `const _: () = assert!(task_tag::COUNT == 96, ...)` guard does NOT cover the inner x-macro completeness — only the outer arm count.

## Anchor cross-refs

- **EXP-012 (WebSocket client cancel re-entry watchpoint)** — `phase1_inventory_F.md` references this section; current-source verdict RESOLVED for `WebSocketUpgradeClient::cancel` with side-by-side evidence above.
- **A-001 (`*mut Self` callback pattern sweep, ~1,610 sites project-wide)** — F's slice is 93 sites. The most caller-fragile shape (`as_response`) was likely sampled and judged sound; the new shapes enumerated above (RuntimeState thread-local, UnsafeCell-Route, RacyCell singleton, MaybeUninit pool slot) should be added to the A-001 sample if they are not already present.
- **Section P (event-loop hub)** — F's `auto_tick` calls into `bun_io::posix_event_loop` and `bun_uws` whose Send/Sync claims are audited in P / Q. Section F itself adds zero Send/Sync surface.
- **Section K (JSC handle discipline)** — F consumes `Strong`/`Weak`/`JsCell` heavily but does not define any new handle types.
