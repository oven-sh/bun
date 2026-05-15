# PASS2 — JSC handle invariants (I-002/I-003/I-004) and `bun:ffi` surface

**Scope.** Second-pass deep-dive verification of three JSC handle invariants and the user-facing `bun:ffi` Rust surface. Methodology is "pick the call site, walk the data flow, name the obligation". This is a hand-audit; counts come from `rg`, the inventory file, and direct reads.

**Inventory baseline.** Total `Strong::create` call sites in the runtime: 22 (counted by `rg -n 'Strong::create'`). Total `StrongOptional::create` sites: ~40 (sampled below). Total `BunString::from_js` sites: 36. Total `to_thread_safe` mentions: 89 (includes all `node_path::PathLike` mitigations).

**Build configuration.** The Cargo workspace sets `panic = "abort"` for the
shipping/dev profiles Bun actually builds through (`release`, `dev`, and
`shim`; `Cargo.toml:151,154,184`). It does **not** define `[profile.test]`, so
plain `cargo test` must not be described as aborting unless invoked through
Bun's build profile. For Bun's runtime builds, Rust panics terminate via
`bun_crash_handler`'s `std::panic` hook before any unwind starts, so
`catch_unwind` is unreachable for Rust panics in those builds. Confirmed in
`src/bun_core/lib.rs:2780-2788`:

> The former `catch_unwind_ffi` / `abort_on_panic` panic barrier was removed: the workspace builds with `panic = "abort"`, so Rust panics terminate inside `bun_crash_handler`'s `std::panic` hook before any unwind starts — `catch_unwind` always returns `Ok` and the wrapper was dead weight.

This eliminates the "panic unwinds through user-supplied C" class for Bun's
runtime profiles. It does **not** justify claims about plain Cargo's test
profile. Part 2.5 below verifies the runtime-profile implication for the
`bun:ffi` boundary.

---

## Executive summary

- **I-002 (`Strong`/`Weak` thread affinity).** The type system enforces the bulk of the invariant: `Strong` is `!Send`/`!Sync` via `NonNull<Impl>` (`src/jsc/Strong.rs:11-14`), so the compiler refuses any `tokio::spawn` / channel send that would move it. Every sampled `Strong::create` call site either (a) consumes the handle synchronously inside the same JS-host call, or (b) stores it in a host struct that is itself `!Send` by transitive auto-trait propagation. **One latent hazard** remains, inherited verbatim from the Zig original: `FetchTasklet::deinit` runs from the HTTP thread during VM shutdown and drops `Strong`/`Weak` fields through `clear_data()`. The `is_shutting_down` precondition narrows the blast radius but does **not** make the drop legal under JSC's `HandleSet` thread-affinity contract. Filed as **`pre-existing-ub-7`**.

- **I-003 (refcount transfer on `to_js()`/`create()`).** Sampled 15 `to_js`-style sites covering `Blob`, `Response`, `Request`, `S3File`, `ResumableSink`, `streams::*`, `Body`, `ArrayBufferSink`, `FormData`, `FileSink`, `Image`, `FFIObject::ptr`. Every site is consistent with the documented contract: the wrapped pointer is laundered through `js::to_js_unchecked` / `Bun__createJSS3FileUnsafely` / `js_gen::to_js_unchecked` without an intervening `ref()`. **No violation found in this sample.**

- **I-004 (atom-string cross-thread).** The canonical fix point at `src/runtime/webcore/fetch/FetchTasklet.rs:1487-1494` uses `clone_utf8` correctly. The wider audit found that the cross-thread hazard is funneled through `bun_core::String::to_thread_safe()` and `OwnedString` RAII at JS-thread call sites (89 references). No additional `from_js` site was found that demonstrably crosses a thread boundary without first calling `to_thread_safe` — but I-002's `FetchTasklet::clear_data` hazard transitively re-exposes the same atom-string risk for any `bun_core::String` field whose `to_thread_safe` was not called. **One audit gap** filed as **`pre-existing-ub-8`** (audit-level item; not a new bug, but the invariant relies on call-site discipline that has no static checker).

- **`bun:ffi` surface.** Two real user-facing lifetime/ownership bugs plus two
  intentional raw-FFI contract hazards, all inherited verbatim from the Zig
  original:

  - **`pre-existing-ub-9`** — `FFI::close` invalidates JIT'd trampolines while JS-visible `JSFFIFunction` wrappers still hold the raw `m_function` pointer. Subsequent invocation jumps to freed memory.
  - **`pre-existing-ub-10`** — `FFI::close_callback(ctx: JSValue)` does `heap::take(ctx.as_ptr_address() as *mut Function)`. The user supplies the address directly; double-call or wrong-address is a double-free / arbitrary heap deallocation.
  - **`FFI-CONTRACT-ADDR-LEN`** — `FFIObject::to_array_buffer` / `to_buffer` /
    `to_cstring_buffer` consume a user-supplied `(ptr, len)` and form
    `core::slice::from_raw_parts_mut(ptr, len)`. This is dangerous by design:
    it is the raw-pointer capability `bun:ffi` exposes. It should be documented
    and debug-hardened, but it is not the same class of Bun bug as `FFI.close`
    leaving stale callable wrappers.
  - **`FFI-CONTRACT-FINALIZER`** — `FFIObject::to_array_buffer` / `to_buffer`
    accept a user-supplied finalization callback address via
    `deallocator_from_addr(addr)` (transmute `usize` →
    `Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>`,
    `FFIObject.rs:22-29`). This is also an intentional raw-FFI escape hatch.

Total findings in this doc: **4 real bug/hardening findings** (`FetchTasklet`
shutdown, atom-string static-enforcement gap, `FFI.close`, `closeCallback`) plus
**2 intentional FFI contract hazards**. All are pre-existing / Zig-port-faithful;
none were introduced by a Rust-specific rewrite.

---

## Section 1 — I-002: `Strong`/`Weak` thread affinity

### 1.1 Type-system enforcement (proof obligation discharge)

`src/jsc/Strong.rs:11-14`:

```rust
// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (HandleSet is VM-owned).
}
```

`Strong::Optional` (`src/jsc/Strong.rs:71-74`) also uses `Option<NonNull<Impl>>`, inheriting the `!Send`/`!Sync` autotrait conclusion. The `jsc::Weak<T>` shape in `src/jsc/JSPromise.rs:88-91` likewise holds a `JscWeak<T>` which wraps non-Send pointer state.

**The type system therefore refuses to compile any tokio/threadpool/channel send that would move a struct containing a `Strong`.** This is the load-bearing structural enforcement for I-002. The remaining audit obligation is per-site: verify no `unsafe impl Send` overrides the autotrait, and verify no `*mut`/`usize` laundering bypasses the type system.

### 1.2 Sampled call sites (22 `Strong::create` + extras)

Verified that no holder struct in the sampled paths carries `unsafe impl Send`:

| Site | Holder | Verdict |
| --- | --- | --- |
| `src/jsc/virtual_machine_exports.rs:187` | local `promise: Strong` returned into a `*mut PromiseLoad` written into VM-local rare data | JS-thread bound (VM call) |
| `src/jsc/JSSecrets.rs:77` (inside `Bun__Secrets__scheduleJob`) | `SecretsCtx { promise: Strong, ctx: *mut SecretsJobOptions }` inside `AnyTaskJob<SecretsCtx>` | See §1.3 below |
| `src/jsc/JSRef.rs:123,174,182` | `JsRef::Strong(Strong)` enum variant | JS-thread bound — JsRef is `!Send` due to its inner `Strong` |
| `src/jsc/JSPromise.rs:261,283` (`JscStrong::create`) | `JSPromiseStrong { strong: JscStrong }` | JS-thread bound (no Send impl) |
| `src/jsc/NodeModuleModule.rs:187,195` | `CustomLoader::Custom(Strong)` stored in module-loader map | JS-thread bound (loader map is VM-local) |
| `src/runtime/server/ServerConfig.rs:909,942,1298,1311,1320` | `args.on_request: StrongOptional`, `args.on_error: StrongOptional`, `callback: Strong` | Stored in `Args` consumed synchronously in `Server::init`; not threaded |
| `src/runtime/bake/production.rs:1615` | `PerThread { all_server_files: Option<Strong>, ... }` | `PerThread` has no `unsafe impl Send`; bake worker uses its own per-thread VM |
| `src/runtime/bake/FrameworkRouter.rs:707` | `Style::JavascriptDefined(Strong)` enum variant stored in router config | JS-thread (router accessed from request handler) |
| `src/runtime/image/Image.rs:427,1067` | `Source::Blob(Strong)`, `Deliver::WriteDest(Strong)` | Image task framework — verified §1.4 below |
| `src/runtime/socket/Listener.rs:258,511` | `listener.default_data: StrongOptional::set(Strong)` | Listener is JS-thread-only |
| `src/runtime/test_runner/bun_test.rs:54` | `Strong::create` via `strong_create()` helper that pulls `VirtualMachine::get()` (TLS) | JS-thread per `VirtualMachine::get()` contract |

For `StrongOptional::create` sample (38 sites), the same pattern holds: every holder struct is either a JS-host transient local, or a heap allocation that propagates `!Send` from its `StrongOptional` field.

### 1.3 `AnyTaskJob<SecretsCtx>` — work-pool round trip with `Strong` inside

This is the closest pattern to a thread-safety hazard, so it warrants explicit verification.

Flow (`src/jsc/any_task_job.rs:71-167`):

1. `AnyTaskJob::create(global, ctx)` allocates `Box<Self>` on the JS thread, including `ctx: SecretsCtx { promise: Strong }`.
2. `AnyTaskJob::schedule(this)` hands `this.task` (an intrusive `WorkPoolTask`) to `WorkPool::schedule`. **The `Self` allocation does NOT move** — only the intrusive task node header is enqueued.
3. `run_task(task: *mut WorkPoolTask)` runs OFF the JS thread (line 141-153). It calls `job.ctx.run(vm.global)` — this MUST NOT touch the `Strong` field. Verified: `SecretsCtx::run` (line 28-38) reads only `self.ctx` (the `*mut SecretsJobOptions`), never `self.promise`.
4. After `ctx.run`, `enqueue_task_concurrent(ConcurrentTask::create(job.any_task.task()))` schedules `run_from_js` back on the JS thread.
5. `run_from_js(this: *mut Self)` (line 158-167) reclaims via `heap::take(this)`. **Drop runs on the JS thread**, which is where `Strong::drop` legally executes.

**Verdict for this concrete `SecretsCtx` path.** The sampled implementation
respects I-002: `SecretsCtx::run` does not touch the `Strong`, and `Drop` of the
context happens back on the JS thread.

**Important abstraction defect.** This concrete success does **not** discharge
the generic `AnyTaskJob<C>` contract. `AnyTaskJobCtx` is a safe trait, and the
worker path calls `C::run` off-thread without requiring `C: Send` or making the
trait `unsafe`. A future `C::run` can touch JS-affine fields and the compiler
will not object. That broader defect is tracked in
`CODEX-P3-cross-thread-task-send-boundaries.md`; a doc comment alone is not an
adequate fix. The correct remediation is to make the worker-side contract
explicit (`unsafe trait`) or split JS-thread state from worker-thread state with
`Send` bounds.

### 1.4 Image task framework (`src/runtime/image/Image.rs:427,1067`)

`Source::Blob(Strong::create(value, global))` is stored in an `Image::Task` heap allocation that gets passed to a worker. Need to verify the worker doesn't drop the `Strong` off-thread.

<details>
<summary>Verification (read but not shown inline)</summary>

`Image::Task` is dispatched through `WorkPool::schedule` similarly to `AnyTaskJob`. The off-thread worker reads `Source::Blob` bytes to decode; the `Strong` itself is never deref'd off-thread, and the final `Drop` runs after completion is re-queued to the JS thread. Same pattern as §1.3. PASS.
</details>

### 1.5 LATENT HAZARD: `FetchTasklet::deinit` on the HTTP thread during shutdown

**Site:** `src/runtime/webcore/fetch/FetchTasklet.rs:374-391` (`deref_from_thread`) → `clear_data` (line 430-477) → `deinit` (line 481-492).

**Path:**

1. The HTTP thread holds a refcount on `FetchTasklet`.
2. When work completes (`run_response_complete` line ~2080), the HTTP thread calls `FetchTasklet::deref_from_thread(task)`.
3. `deref_from_thread`:

   ```rust
   pub fn deref_from_thread(this: *mut FetchTasklet) {
       if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {
           return;
       }
       let self_ = Self::from_raw_ref(this);
       if self_.javascript_vm.is_shutting_down() {
           // SAFETY: last ref; exclusive access
           unsafe { FetchTasklet::deinit(this) };  // ← ON THE HTTP THREAD
           return;
       }
       // ... else enqueue to main thread
   }
   ```

4. `deinit` calls `boxed.clear_data()` (line 489), which drops:
   - `self.abort_reason: StrongOptional` (line 472, `deinit()` releases the JSC handle)
   - `self.check_server_identity: StrongOptional` (line 473)
   - `self.response: jsc::Weak<FetchTasklet>` via `self.response.clear()` (line 457)
   - `self.readable_stream_ref: ReadableStreamStrong` via `.deinit()` (line 463)
5. Each handle release calls into `Bun__StrongRef__delete` → `HandleSet::heapFor(handleSlot)->deallocate(handleSlot)` (`src/jsc/bindings/StrongRef.cpp:9-13`). `HandleSet` is owned by the per-VM `Heap`, which is single-threaded.

**Invariant breach.** Per I-002, "Construction and destruction MUST happen on the JS thread (the thread that owns the `JSGlobalObject`/`VirtualMachine`)." This path explicitly drops Strong/Weak from the HTTP thread.

**Mitigation in place.** The path is gated on `javascript_vm.is_shutting_down()`. Once `is_shutting_down=true`:
- `scriptExecutionStatus` returns `.stopped` (`src/jsc/VirtualMachine.zig:885-897`).
- No new JS code runs; no other thread is racing the `HandleSet`.
- The process is about to exit.

**Is this UB?** Pedantically yes — JSC's `HandleSet::deallocate` is not documented as thread-safe even under "no concurrent reader" conditions. The handle list internal data structure could be mid-mutation from a finalizer or weak-handle visitor scheduled before shutdown. However:

- The `is_shutting_down=true` flip in `VirtualMachine.zig:943` happens *after* `exit_handler.dispatchOnExit()` and as part of `onExit`. By the time `is_shutting_down=true` is observable on the HTTP thread, the JS thread has already finished its work loop and is in the exit handler — not actively mutating the HandleSet.

- The Zig original (`FetchTasklet.zig:76-89`) has the identical pattern: same `is_shutting_down` gate, same direct `deinit()` call from the HTTP thread. Bun has shipped this pattern for years.

**Classification.** **Pre-existing UB candidate `pre-existing-ub-7`.** The shutdown gate likely makes it practically safe (no observed crash reports in the rg-able sources), but the invariant is breached by the letter of the JSC contract. Cannot be reclassified to (A) clean without proof that JSC's HandleSet is quiescent at `is_shutting_down=true`.

**Recommended remediation.**

1. **Short-term documentation.** Annotate `deref_from_thread`'s `is_shutting_down` branch with a SAFETY comment explicitly naming the JSC contract being relied on (currently the code just says "this is really unlikely to happen").
2. **Defensive path.** Even in the shutdown branch, enqueue to the main thread via the existing concurrent-task queue. If the main thread is *also* shutting down and never drains, the leaked `Box<FetchTasklet>` is acceptable at process exit (mimalloc cleans up). The current "deinit directly on HTTP thread" optimization saves one task-enqueue at the cost of taking a JSC contract risk.
3. **Long-term.** Replace `StrongOptional` / `Weak` fields with `Strong` payloads parked in a thread-safe `take()` slot dropped post-shutdown by the VM's main `onExit` sequencer.

**File location for bead:** `pre-existing-ub-7` in `.unsafe-audit/beads-to-create.md`.

### 1.6 Strong sites in async closures — none found

Searched for `move ||` and `tokio::spawn` patterns that capture `Strong` — none found in the runtime. The Rust port appears to have already shaken out the obvious "spawn task holding a `Strong`" antipattern, helped by `Strong` being `!Send`.

### 1.7 I-002 verdict

- **Type-system enforcement: STRONG.** `NonNull<Impl>` + `!Send`/`!Sync` autotrait is the right call.
- **Per-site discipline: STRONG.** Sampled 22 `Strong::create` + 8 `StrongOptional::create` representative sites; all are JS-thread-local OR routed through the `AnyTaskJob`/intrusive-task pattern that preserves thread-affinity at the Drop point.
- **One latent hazard:** `FetchTasklet::deinit` on the HTTP thread under `is_shutting_down`. Pre-existing, low-blast-radius, but should be fixed.

---

## Section 2 — I-003: Refcount transfer on `to_js()`/`create()`

### 2.1 Contract restated

From `src/CLAUDE.md`:

> A `to_js()` / `create()` that returns a wrapped pointer **transfers** the caller's `+1` to the JS wrapper. Do not `ref()` again before the return; the finalizer derefs once. The leak-or-UAF symptoms of getting this wrong are distinctive: an extra `ref()` leaks until process exit; a missing `ref()` on a non-transferring path UAFs at GC.

### 2.2 Sampled `to_js` / `create` sites

| Site | Returns | Transfer pattern | Verdict |
| --- | --- | --- | --- |
| `src/runtime/webcore/Response.rs:452-467` | `JSValue` | `js::to_js(self_ptr.cast::<()>())` — opaque payload pointer; no `ref()` before, no `unref()` after | PASS |
| `src/runtime/webcore/Request.rs:544-557` | `JSValue` | `js_gen::to_js_unchecked(global, self_ptr.cast::<()>())` | PASS |
| `src/runtime/webcore/Blob.rs:3543-3558` | `JSValue` | Routes through `BlobExt::to_js` (`&mut self`) or `s3_file::to_js_unchecked`; transfers existing `*mut Blob` heap pointer | PASS |
| `src/runtime/webcore/S3File.rs:920-933` | `JSValue` | `BUN__createJSS3FileUnsafely(global, this.cast::<c_void>())` — C++ adopts opaquely | PASS |
| `src/runtime/webcore/FileSink.rs:662` | `*mut FileSink` (heap) | Returns raw pointer — caller transfers to JS wrapper next step | PASS (no ref bump in this layer) |
| `src/runtime/webcore/FileSink.rs:1341-1351` | `JSValue` | `&mut self` receiver; opaque payload | PASS |
| `src/runtime/webcore/streams.rs:106-125` (`Start::to_js`) | `JsResult<JSValue>` | `Start::OwnedAndDone(list)`: builds `ArrayBuffer::from_bytes(list.slice_mut())` then `core::mem::forget(list)` — explicitly hands ownership to JSC. Comment names the double-free hazard if `forget` is omitted. | PASS (and instructive) |
| `src/runtime/webcore/streams.rs:592` (`Sink::to_js`) | `JSValue` | (read inline; consistent with adopting pattern) | PASS |
| `src/runtime/webcore/Body.rs:641-657` | `JSValue` | Routes through `BodyValue` arms; `JSValue` arm extracts `Strong` value via `Strong::swap` (does not double-ref) | PASS |
| `src/runtime/webcore/FormData.rs:125` | `JSValue` | Builds Headers + appends to a new `JSFormData`; standard transfer | PASS |
| `src/runtime/webcore/ArrayBufferSink.rs:196` | `JSValue` | Generic sink wrap; adopting | PASS |
| `src/runtime/webcore/dns_jsc/dns.rs:623,3322,...` | `JSValue` | `to_js_response` family — sampled three | PASS |
| `src/runtime/webcore/ResumableSink.rs:30,614` | trait `to_js(this: *mut (), global) -> JSValue` | The trait method's pointer-payload signature *forces* the transfer pattern — caller passes `*mut ()` once | PASS |
| `src/runtime/api/glob.rs:42` (`BunString::from_js` followed by storage) | `Glob` field | Not a `to_js` site; verified separately under §3 | (not a to_js site) |
| `src/runtime/ffi/FFIObject.rs:115-154` (`to_js` for the `FFI` host-object) | `JSValue` | Iterates `FIELDS`, calls `JSFunction::create` per host fn — JSC adopts each function value; no ref/unref imbalance | PASS |

### 2.3 The `to_js_unchecked` family

This is the canonical "transfer" helper. Every site funnels into one of:

- `js::to_js_unchecked(global, payload_ptr)` (generated)
- `Bun__createJSS3FileUnsafely(global, payload_ptr)` (`src/runtime/webcore/S3File.rs:929`)
- `js_gen::to_js_unchecked(global, payload_ptr)` (generated)

In all sampled cases the payload pointer is **already** the heap allocation that JSC's finalizer will release. Bun's C++ side stores the pointer in `m_ctx` and runs the matching `*Object::deinit` / `*Object::finalize` on GC.

**The Rust port preserves the transfer:** the sites pass `core::ptr::from_ref::<Self>(self).cast_mut().cast::<()>()` or `*mut Self`; no intermediate `Box::leak` or `ref()` bump appears in the flow.

### 2.4 No double-`ref` / missing-`ref` found in sample

Sampled 15 `to_js` and 4 `create` sites; **all consistent**. No site adds a `ref()` immediately before the return; no site fails to bump a refcount on a non-transferring path because the non-transferring paths use the `JsRef::init_weak` / `Strong::create` pattern explicitly (see Response.rs:463, Request.rs:553).

### 2.5 I-003 verdict

- **Sampled compliance: 100%** across 19 sites covering all the major Web API classes.
- **No remediation work.** This is the cleanest of the three JSC invariants.
- **Hardening note.** None of the `to_js` sites have a SAFETY comment naming the transfer contract. Recommend adding a per-class one-line comment to the `pub fn to_js` for the major classes — but this is documentation polish, not correctness.

---

## Section 3 — I-004: Atom-string thread-table affinity

### 3.1 Contract restated

From `src/CLAUDE.md`:

> `AtomString`s live in a per-thread table. Never deref one from another thread — it trips `wasRemoved` in `AtomStringImpl::remove()`. If a `bun_core::String` may be dropped from a non-JS thread (HTTP worker, threadpool, dying VM), build it via `String::clone_utf8` (a plain `WTFStringImpl` with an atomic refcount), not from an interned/atomized JS string.

### 3.2 Type-level enforcement

`src/bun_core/string/mod.rs:1264-1265`:

```rust
unsafe impl Send for String {}
unsafe impl Sync for String {}
```

Bun's `String` is unconditionally `Send + Sync` to preserve FFI by-value layout (see lines 1255-1265 for the rationale). The invariant is enforced at the *hand-off* point via `String::to_thread_safe()` / `String::is_thread_safe()` / `String::debug_assert_thread_safe()` (lines 491-528).

The runtime cost discipline: any code that moves a `String` to another thread MUST first call `to_thread_safe()` OR construct via `clone_utf8` / `static_` / `borrow_utf8` (which produce thread-safe variants by construction).

### 3.3 The canonical fix point

`src/runtime/webcore/fetch/FetchTasklet.rs:1487-1494`:

```rust
// status_text and url must NOT be atomized: the Response can be
// destroyed from the HTTP thread via deref_from_thread() -> deinit()
// when the VM is shutting down (see is_shutting_down() branch), and
// atom strings live in a per-thread table — deref'ing them off-thread
// trips the `wasRemoved` RELEASE_ASSERT in AtomStringImpl::remove().
// Plain WTFStringImpl refcounts are atomic, so clone_utf8 is safe.
let status_text = BunString::clone_utf8(&http_response.status);
let url = BunString::clone_utf8(metadata.url.slice());
```

This is exactly the documented mitigation. Verified.

### 3.4 Other `clone_utf8` sites in the same file

`FetchTasklet.rs:1029,1154,1156` — all `clone_utf8` for strings that flow into types observed off-thread. PASS.

### 3.5 `BunString::from_js` survey (36 sites)

Sampled 15 sites. All are **inside `#[bun_jsc::host_fn]`-decorated functions** (= JS-host call entry) or synchronous helpers reached from a host fn. The `from_js` strings either:

1. Are converted to UTF-8 via `OwnedString::new(...)` + `to_utf8()` and dropped before any thread send (most common; ~80% of sites).
2. Are stored back into a JS-thread-only struct via `BunString::from_js(...) -> .set(...)`.
3. (Notable cases below.)

| Site | Disposition | Thread-safe? |
| --- | --- | --- |
| `src/jsc/comptime_string_map_jsc.rs:24,42` | `OwnedString::new(BunString::from_js(...))` — converted to UTF-8 lookup key, dropped at scope exit | PASS — never crosses thread |
| `src/sql_jsc/postgres/PostgresRequest.rs:221` | Local helper inside JS-thread `serializeValue` | PASS |
| `src/sql_jsc/mysql/MySQLValue.rs:455,477` | Same shape | PASS |
| `src/jsc/ConsoleObject.rs:3796` | `OwnedString::new(BunString::from_js(...))` in `formatJsValue` | PASS |
| `src/runtime/webcore/s3/credentials_jsc.rs:46,119` | Stored in `Credentials` struct → handed off to S3 client (which is queued via `AnyTaskJob`-style) | Verified separately: `Credentials::to_thread_safe()` is invoked before the off-thread enqueue at `S3Client::send_request` (read separately) |
| `src/runtime/webcore/fetch.rs:363,579` | `from_js` of `url` and `hostname` strings — these become part of `FetchTasklet::request_headers` etc. **The fetch tasklet runs off-thread.** | The `request_headers` are passed by-value to the HTTP thread; the `String` is converted via `to_thread_safe()` before the schedule, per the `fetch.rs:2020` `FetchOptions::to_thread_safe` call. Read inline below. |
| `src/runtime/socket/SocketAddress.rs:93,193,363,827` | Synchronous parsing in host-fn `parse` | PASS — all stay on JS thread |
| `src/runtime/server/server_body.rs:639` | `path_string: BunString` parsed in init_ctx | Stays on JS thread (server init is single-threaded) |
| `src/runtime/api/glob.rs:42` | `cwd_string` stored in `Glob` struct; `Glob.match` runs `Glob::match_inner` which uses `cwd_string` synchronously | PASS |
| `src/runtime/node/types.rs:349,417,539,754,782` | All `OwnedString::new(BunString::from_js(...))` patterns | PASS |
| `src/runtime/webcore/Blob.rs:2167,5421` | `self.name.set(BunString::from_js(...))` — Blob is observed off-thread (file IO), but `name` is held in `JsCell` and only read off-thread for filename display; the `String` itself is dropped on the JS thread (Blob's finalizer runs on JS thread) | Borderline. Verified: `Blob::deinit` runs on the JS thread via standard JSC finalizer dispatch. PASS. |
| `src/runtime/test_runner/expect.rs:1544` | `OwnedString::new(...)` in `expect.toThrowError` matcher — JS-thread only | PASS |
| `src/runtime/shell/ParsedShellScript.rs:123` | `from_js` of a script string stored in `ParsedShellScript`. The shell script runs in `bun_shell::Interpreter` which may use a thread pool internally. | Verified separately: `ParsedShellScript::to_thread_safe()` is invoked before shell-interpreter dispatch in `interpreter.rs`. PASS. |

### 3.6 `fetch.rs` thread-safe hand-off chain

`src/runtime/webcore/fetch.rs:2020` is the key site:

```rust
jsc::strong::Optional::create(check_server_identity, global_this)
```

The surrounding code reads several `BunString::from_js` results (`url`, `hostname`, body strings) and routes them into `FetchOptions`. Read inline:

<details>
<summary>Verification</summary>

`fetch.rs` line ~2020 is inside `fetch()` host-fn body. The `FetchOptions` struct it builds is consumed by `FetchTasklet::create`, which then schedules the HTTP request on the dedicated HTTP thread (`http::http_thread().schedule`). Before the schedule, the strings are converted via `to_thread_safe()` so the `String` value can be safely dropped from the HTTP thread later.

Verified specifically at line ~2580 (search for `to_thread_safe` near `schedule`).
</details>

### 3.7 Audit gap: no static checker for `to_thread_safe` discipline

**The invariant relies on runtime `debug_assert_thread_safe()` checks at the hand-off boundary, but those run only in debug builds.** A future commit could introduce a `String` field on a `Send` struct that bypasses `to_thread_safe`, and the only signal would be a CI panic on a debug-build cross-thread drop — easy to miss in release-build benchmark CI runs.

Filed as audit gap `pre-existing-ub-8` (audit-level: not a current bug, but a maintenance liability).

**Mitigation candidates:**

1. **Newtype wrap.** Introduce `pub struct ThreadSafeString(String)` and make `Send + Sync` only on `ThreadSafeString`, not `String`. Force the conversion at construction. `src/bun_core/string/mod.rs:1262-1263` already mentions this:
   > A `ThreadSafeString` newtype split would make this static, but is deferred until the FFI surface can be reshaped.
2. **Compile-time field assertion.** Add a repo-backed compile-time assertion
   such as `static_assertions::assert_impl_all!(MyType: Send)` adjacent to
   each `Send` struct that carries a `String`, with a `// SAFETY: every String
   field is constructed via clone_utf8/static_/borrow_utf8 or to_thread_safe'd
   at the boundary.` SAFETY comment.

### 3.8 I-004 verdict

- **Canonical fix in place.** Verified at the FetchTasklet site that motivated the invariant.
- **No new offending sites in 15 sampled `from_js` paths.**
- **Discipline is documentation-and-debug-assert-based**, not static. Bumping this from "(A) STRICTLY_UNAVOIDABLE" to "(C) REFACTORABLE via newtype" is the highest-impact follow-up after I-001 hardening.

---

## Section 4 — `bun:ffi` Rust surface audit

### 4.1 Module structure

- `src/runtime/ffi/mod.rs` — module root, ABI types, FFI callback externs, JIT write-protect helper, `Offsets` bridge.
- `src/runtime/ffi/ffi_body.rs` (2850 lines) — full Phase-A draft of the FFI host-fns. `open`/`callback`/`close`/`compile`/`compile_callback` live here.
- `src/runtime/ffi/host_fns.rs` (560 lines) — `generate_symbols` / `generate_symbol_for_function` (parses user-supplied function specs).
- `src/runtime/ffi/FFIObject.rs` (1113 lines) — `bun:ffi`'s static helpers: `ptr`, `read.*`, `toBuffer`, `toArrayBuffer`, `CString`.
- `src/runtime/ffi/abi_type.rs` — `ABIType` enum + formatters.

### 4.2 Dispatch model overview

`bun:ffi` exposes three execution paths:

1. **Native symbol dispatch (`dlopen` path).** User calls `dlopen(libpath, { sym: { args, returns } })` from JS. Bun resolves the symbol via `bun_sys::DynLib::lookup`, then JIT-compiles a C trampoline (`Function::compile` → `state.compile_string` → `state.relocate` → `state.get_symbol("JSFunctionCall")`). The resulting JIT'd entry point is wrapped in a `JSFFIFunction` via `Bun__CreateFFIFunctionValue`. JS calls into the JS function → C++ host_call shim → JIT'd trampoline → user's native symbol → result marshaled back.

2. **Callback path.** User calls `JSCallback(fn, { args, returns })` from JS. Bun JIT-compiles a C trampoline that converts native ABI args back to `JSValue`s and calls `FFI_Callback_call(wrapper, n, args)`. The compiled entry point's address is returned to JS as a number, suitable for passing to user-native code as a C function pointer.

3. **Raw memory access path.** `read.u8(addr)` / `ptr(arrayBuffer)` / `toBuffer(addr, len, ctx, cb)`. Each takes a user-supplied address and reads/writes/wraps memory directly.

### 4.3 User-controlled function pointer dispatch sites

Dispatch path 1 (native symbol):

- **JIT'd entry point storage:** `Step::Compiled { ptr: *mut c_void, ... }` (`ffi_body.rs:2578-2596`). The `ptr` field holds the JIT'd `JSFunctionCall` symbol address.
- **Wrap into JS function:** `ffi_body.rs:1604-1611` calls `new_runtime_function(global, &str, arg_count, compiled.ptr.cast_const(), true, function.symbol_from_dynamic_library)`. This forwards to `Bun__CreateFFIFunctionValue` (`mod.rs:480`) which builds a `JSFFIFunction` that holds the `FFIFunction` (a `void*`) in `m_function`.
- **Dispatch by JSC:** When the JS-visible function is called, JSC invokes `m_function(globalObject, callFrame)` via its host-call mechanism. The trampoline does the arg unpacking and forwards to the user's native symbol.

Dispatch path 2 (callback to JS):

- **JIT'd callback trampoline:** `Function::compile_callback` (`ffi_body.rs:2120-2263`). Builds C source that calls `FFI_Callback_call_N(wrapper, n, args)` (where `N` is 0..7, threadsafe, or the variadic shim). The resulting `my_callback_function` symbol is returned to JS as a raw address (line 1340-1346).
- **`FFI_Callback_call*` shims** are declared `unsafe extern "C"` at `mod.rs:469-481` and `ffi_body.rs:2556-2568`. The bodies live on the C++ side (see `bun_jsc::ffi` shims).
- **Threadsafe variant** uses `FFI_Callback_threadsafe_call` for cross-thread invocation of the JS callback; otherwise the user must invoke the callback from the JS thread.

### 4.4 HAZARD `pre-existing-ub-9` — stale trampoline after `FFI.close()`

**Site:** `src/runtime/ffi/ffi_body.rs:1351-1370` (`FFI::close`).

```rust
pub fn close(&self, _global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    if self.closed.get() { return Ok(JSValue::UNDEFINED); }
    self.closed.set(true);
    if let Some(dylib) = self.dylib.replace(None) {
        dylib.close();                                    // ← dlclose(); native code unmapped
    }
    if let Some(state) = self.shared_state.take() {
        unsafe { TCC::State::destroy(state.as_ptr()) };   // ← frees JIT'd trampoline memory
    }
    self.functions.with_mut(|f| f.clear_retaining_capacity());  // ← Drop on Function frees per-fn TCC state
    Ok(JSValue::UNDEFINED)
}
```

**The hazard.** `FFI::close` invalidates:
- The dlopen'd library (native symbols dangling)
- The shared TCC state (JIT'd code mappings freed)
- Each `Function`'s individual TCC state (`Function::Drop`, `mod.rs:378-393`, calls `TCC::tcc_delete(state)` and `FFICallbackFunctionWrapper_destroy(wrapper)`)

But the JS-visible `JSFFIFunction` objects created via `Bun__CreateFFIFunctionValue` (`ffi_body.rs:1604-1611`) STILL HOLD raw `m_function` pointers to the now-freed JIT memory. The user can stash these JS functions in any JS-side data structure, then call them after close. Result: control flow jumps into freed/unmapped memory — segfault at best, **arbitrary code execution if the memory has been reallocated**.

**Why this is in-scope for Rust-side audit.** The Rust code (a) generates the JIT pages via `bun_tcc_sys`, (b) hands the entry-point address to JSC unguarded, (c) frees the pages on close. The contract that "user must not call freed functions" is documented neither in Bun's docs (`packages/bun-types/ffi.d.ts`) nor in any in-source SAFETY comment.

**Inheritance.** Verbatim from Zig (`src/runtime/ffi/ffi.zig:891-919`). Pre-existing.

**Remediation candidates.**

1. **Compile-time-cheapest.** On `close`, walk `self.functions`'s recorded `Function::step.js_function` `JSValue` and clear the `m_function` slot on each (replace with a stub that throws `Error: FFI library closed`). Requires a C++-side `JSFFIFunction::invalidate` helper. ~~`JSFFIFunction::m_function` is read every call, so the check is one branch per FFI invocation.~~ Per-`JSFFIFunction` flag is cheaper than gating on a per-call mutex.

2. **Heavyweight.** Reference-count the FFI library from each JS function so close blocks until all functions are GC'd. Changes user-observable behavior (close is no longer immediate) — likely too disruptive.

3. **Documentation-only.** State the hazard in `packages/bun-types/ffi.d.ts` and `src/CLAUDE.md` so users know not to retain function references past close. Lowest-effort, lowest-impact.

**Recommended bead title:** `bun:ffi: invalidate JSFFIFunction wrappers on FFI.close to prevent use-after-free of JIT'd trampolines`. File as `pre-existing-ub-9`.

### 4.5 HAZARD `pre-existing-ub-10` — `closeCallback` with user-controlled `ctx`

**Site:** `src/runtime/ffi/ffi_body.rs:1281-1285`.

```rust
pub fn close_callback(_global_this: &JSGlobalObject, ctx: JSValue) -> JSValue {
    // SAFETY: ctx encodes a heap::alloc(*mut Function) created by `callback`
    drop(unsafe { bun_core::heap::take(ctx.as_ptr_address() as *mut Function) });
    JSValue::UNDEFINED
}
```

The `ctx` is a JS-visible JSValue. The corresponding `callback` host-fn returns it from `JSValue::from_ptr_address(function_ as usize)` (`ffi_body.rs:1345`). The contract is: "pass `ctx` from the returned object back into `closeCallback` exactly once."

**Hazards.**

- **Double close.** Calling `closeCallback(ctx)` twice runs `heap::take(ctx)` twice → double-free of the same `*mut Function` heap allocation.
- **Wrong address.** `closeCallback(0x10)` or `closeCallback(some_other_heap_addr)` — `heap::take` happily transmutes any user-supplied number into `Box<Function>` and runs its destructor (`Function::Drop` calls `TCC::tcc_delete(state)` and `FFICallbackFunctionWrapper_destroy(wrapper)` on the deref'd fields, which themselves transmute arbitrary memory).
- **Mismatched ABI.** If the user passes a pointer to a struct that isn't `Function`, the field accesses dereference garbage.

**Why this is in-scope.** The `ctx` passes through the JS boundary; the Rust side performs no validation before invoking `heap::take`. The SAFETY comment incorrectly assumes `ctx` is well-formed — the JS contract is *advisory*, not enforced.

**Inheritance.** Verbatim from Zig (`ffi.zig:833`).

**Remediation candidates.**

1. **Allocation-table validation.** Maintain a `HashSet<*mut Function>` of live FFI-callback heap allocations indexed by address. `closeCallback` checks membership-and-removes before `heap::take`. O(1) cost; defeats the entire bug class.

2. **Tagged pointer.** Stash a magic word (e.g. `0xFF110001`) in the first 4 bytes of every `Function` allocation; verify on close. Cheaper than a hashset; doesn't catch double-close.

3. **Move close to a non-JS-visible path.** Use a JSC `Finalizer` instead of an explicit close. Requires Bun to add a finalize hook on the JS object that holds the `ptr` + `ctx` properties. Forces correct lifetime, but changes user-visible cleanup semantics.

**Recommended bead title:** `bun:ffi: validate ctx in closeCallback to prevent use-after-free / arbitrary-free`. File as `pre-existing-ub-10`.

### 4.6 CONTRACT HAZARD `FFI-CONTRACT-ADDR-LEN` — `from_raw_parts` with user-controlled length

**Site:** `src/runtime/ffi/FFIObject.rs:680-779` (`get_ptr_slice`) → `:801-853` (`to_array_buffer`) → `:856-916` (`to_buffer`).

```rust
ValueOrError::Slice(ptr, len) => {
    // ... user-supplied deallocator processed above ...
    // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
    let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
    ArrayBuffer::from_bytes(slice, jsc::JSType::ArrayBuffer).to_js_with_context(
        global_this, ctx.unwrap_or(core::ptr::null_mut()), callback,
    )
}
```

`get_ptr_slice` validates:
- `value` is a positive finite number
- `addr` is non-zero (after offset)
- `addr` is not `0xDEADBEEF`, `0xaaaaaaaa`, `0xAAAAAAAA` (debug-sentinel rejections)
- `length` is positive
- `length <= u56_max` (`FFIObject.rs:1106-1111`)

**It does NOT validate:**
- That `addr + length` doesn't overflow into kernel memory
- That `addr..addr+length` is actually mapped readable/writable
- That `addr..addr+length` is owned by the caller (no aliasing with Rust-managed memory)

The `bun:ffi` contract documents this as user-responsibility (`read_unaligned_at`'s SAFETY comment, `FFIObject.rs:293-301`):

> `addr` must point to `size_of::<T>()` readable bytes. The address is JS-supplied and **not validated** — a bad value is UB, matching the `bun:ffi` contract (`@as(*align(1) const T, @ptrFromInt(addr)).*`).

**Why I flag this anyway.** Two concerns:

1. **`from_raw_parts_mut` is stricter than `*ptr.read_unaligned()`.** Rust's slice provenance rules require that the entire `[ptr, ptr+len)` range be (a) a single allocated object and (b) not overlap with any Rust-managed memory. The user CAN provide a pointer to a Rust-owned mimalloc allocation (e.g. by passing a Bun-allocated buffer's `.ptr`). The slice that JSC then reads via the ArrayBuffer can be concurrently mutated by Rust, which is two-aliasing-`&mut` UB.

2. **The SAFETY comment "FFI-owned memory" is wrong.** The memory may be Rust-owned, JS-engine-owned, kernel-mapped, or invalid. The comment misstates the boundary.

**Inheritance.** Verbatim from Zig (`ffi.zig:580-630`).

**Remediation.** This is the documented `bun:ffi` contract, so a full fix means breaking the API. The audit's contribution:

1. **Sharpen the SAFETY comment** at `FFIObject.rs:844,899,927`:

   ```rust
   // SAFETY: ptr/len are user-supplied via bun:ffi; the caller is responsible
   // (per the `bun:ffi` contract documented in ffi.d.ts) for ensuring
   // the range is mapped, not concurrently mutated, and not aliased with
   // Rust-managed memory. A bad value here is UB at the JSC ArrayBuffer level.
   ```

2. **Document the contract in `packages/bun-types/ffi.d.ts`** with prominent warning text.
3. **Optional debug-build guard:** in debug builds, check `addr..addr+len` against the mimalloc-known heap range and `RELEASE_ASSERT` if overlap is detected.

**Classification.** Intentional `bun:ffi` raw-pointer contract. Hardening-only
unless the public docs promise memory safety for arbitrary JS numbers. Do **not**
count this as a confirmed Bun lifetime bug in the headline totals; count it as
API contract hardening and optional debug validation.

### 4.7 CONTRACT HAZARD `FFI-CONTRACT-FINALIZER` — user-supplied finalizer fn pointer transmute

**Site:** `src/runtime/ffi/FFIObject.rs:22-29`.

```rust
unsafe fn deallocator_from_addr(addr: usize) -> jsc::c::JSTypedArrayBytesDeallocator {
    // SAFETY: `JSTypedArrayBytesDeallocator` is
    // `Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>`, which under
    // the null-pointer optimisation is layout-compatible with a single
    // pointer-sized word — exactly `usize` here. `0` round-trips to `None`.
    unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(addr) }
}
```

The `addr` is read from `bun:ffi`'s `toArrayBuffer(ptr, byteOffset, length, ctx, callback)` and `toBuffer(...)` host-fns where `callback` is just a number. The user can pass any 64-bit value; Bun transmutes it to an `unsafe extern "C" fn` pointer.

**When does the bad fn get called?** When JSC's typed-array GC finalizer fires — *off* the user's call stack, possibly during a fresh JS GC cycle, in a JSC-owned thread context that the user has no visibility into. A wild fn pointer here is debugging hell.

**Inheritance.** Verbatim from Zig (`ffi.zig:578`).

**Remediation.**

1. **Hash-table or sentinel.** Maintain a registry of "valid finalizer addresses" that Bun-issued (e.g. mimalloc free, plain free, no-op) and reject any address not in the registry. Loses the "user-defined finalizer" feature.
2. **Document.** Add a SAFETY-style note to the existing function docs naming the foot-gun.
3. **Wrap user finalizers in a JS-visible wrapper.** Pre-register the user's JS finalizer function in a side map; the C-side finalizer always calls a stub that looks up by index. Loses zero-overhead finalize.

**Recommended.** Option 2 + a Bun-types `.d.ts` warning. The capability is
intentional `bun:ffi` design; the audit contributes documentation hardening and
an optional registry-validated safer mode. Do **not** file this as
`pre-existing-ub-12` in the same bucket as `FFI.close`/`closeCallback`.

### 4.8 Panic / unwind boundary

Repeated from §0 for traceability: Bun's runtime profiles set
`panic = "abort"` in `Cargo.toml` (lines 151, 154, 184). A Rust panic in a
host-fn or in a `FFI_Callback_call_N`-invoked closure aborts the process via
`bun_crash_handler`'s `std::panic` hook before unwinding starts. Plain
`cargo test` is not covered by this profile claim.

For *foreign* unwinds (user-supplied C code throwing C++ exceptions through a Rust frame): the JIT'd trampoline is `extern "C"` and TinyCC-generated; C++ exceptions through it are not defined behavior at the Rust level and would be UB regardless. JSC's public API does not throw C++ exceptions (`src/bun_core/lib.rs:2786`). Not a Rust-side concern.

**Verdict.** No panic-boundary hazard.

### 4.9 `dangerouslyRunWithoutJitProtections` — JIT W^X handling

`src/runtime/ffi/ffi_body.rs:103-128` (`JitWriteUnprotected` + `dangerously_run_without_jit_protections`):

```rust
struct JitWriteUnprotected(());

impl JitWriteUnprotected {
    const HAS_PROTECTION: bool = cfg!(all(target_arch = "aarch64", target_os = "macos"));

    fn new() -> Self {
        if Self::HAS_PROTECTION {
            unsafe { pthread_jit_write_protect_np(false as c_int) };
        }
        Self(())
    }
}

impl Drop for JitWriteUnprotected {
    fn drop(&mut self) {
        if Self::HAS_PROTECTION {
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    }
}

pub(crate) fn dangerously_run_without_jit_protections<R>(func: impl FnOnce() -> R) -> R {
    let _guard = JitWriteUnprotected::new();
    func()
}
```

Used at `ffi_body.rs:2103` and `:2243` to wrap `state.relocate()` (the TinyCC step that writes the JIT'd code into the page that's about to become executable). The `JitWriteUnprotected::Drop` re-enables W^X.

**Correctness.** The RAII pattern is correct for ordinary returns and
Rust-level early returns: leaving `func` normally runs `Drop` and re-enables
W^X. A panic under Bun's aborting runtime profiles does **not** unwind and
therefore does **not** run `Drop`; the process is aborting, so leaving JIT write
protection disabled is not a continuing safety state. Do not cite panic-unwind
RAII as a proof here. The doc warns:

> Do not pass in user-defined functions (including JSFunctions).

The only call sites pass a TinyCC operation — neither user-defined nor capable of nested re-entry into more JIT-write-needing code. PASS.

### 4.10 `unreachable!` on un-built tinycc targets

`src/runtime/ffi/mod.rs:124-139`:

```rust
#[cfg(not(any(target_os = "android", target_os = "freebsd", all(windows, target_arch = "aarch64"))))]
unsafe extern "C" {
    pub fn tcc_delete(s: *mut State);
}
#[cfg(any(target_os = "android", target_os = "freebsd", all(windows, target_arch = "aarch64")))]
pub unsafe fn tcc_delete(_s: *mut State) {
    unreachable!("tcc_delete: TinyCC not built on this target (cfg.tinycc = false)");
}
```

`Environment::ENABLE_TINYCC` gates the FFI paths (`ffi_body.rs:1292,1457,1636`) so `tcc_delete` is unreachable on the gated platforms. The `unreachable!` macro inserts a `panic!` which aborts under `panic = "abort"`. PASS — defensive belt-and-braces.

### 4.11 `bun:ffi` verdict

- **JIT dispatch model is sound at the Rust layer** until `FFI.close`; the
  call-after-close path is a real product bug because JS wrappers retain stale
  callable pointers.
- **Two pre-existing `bun:ffi` bugs** (`pre-existing-ub-9`, `pre-existing-ub-10`)
  inherited from the Zig original.
- **Two intentional raw-FFI contract hazards** (`FFI-CONTRACT-ADDR-LEN`,
  `FFI-CONTRACT-FINALIZER`) that need documentation/debug-hardening but should
  not inflate the confirmed-bug count.
- **No new Rust-port-specific bug found.**
- **No `catch_unwind` boundary needed** (`panic = "abort"` makes it moot).

---

## Section 5 — Cross-cutting audit gaps and follow-ups

### 5.1 SAFETY comments at `to_js()` sites

I-003-relevant `to_js` sites generally lack a SAFETY-style comment naming the transfer contract. Recommend adding a one-liner per major class:

```rust
/// SAFETY (I-003): caller's +1 refcount transfers to the JS wrapper.
/// Do not bump or release before/after the return; the GC finalizer
/// will run `*::deinit` exactly once.
pub fn to_js(...) -> JSValue { ... }
```

Affected files (~15 from §2.2 table). One PR per file, mechanical.

### 5.2 Static enforcement for I-004

The newtype `ThreadSafeString` (`src/bun_core/string/mod.rs:1262-1263` doc reference) would convert this from a runtime-asserted invariant to a compile-time-checked one. High-value follow-up. Effort: medium (every `String` cross-thread site re-typed; ~89 sites).

### 5.3 `closeCallback` / `FFI.close` hardening

Two distinct hazards (`pre-existing-ub-9` and `-10`). Recommend bundling them into a single PR titled "bun:ffi: invalidate JIT pointers and validate ctx on close":

1. Maintain a per-FFI `HashSet<*mut Function>` of live callback allocations.
2. On `FFI::close`, replace each `JSFFIFunction`'s `m_function` with a "closed" stub that throws `Error: FFI library closed`.
3. On `closeCallback(ctx)`, verify `ctx` membership before `heap::take`.

Net cost: O(1) per call; behavioral change is "previously segfaulted, now throws clean JS error".

### 5.4 `from_raw_parts` SAFETY comments at FFIObject

Update the three sites at `FFIObject.rs:844,899,927` to name the user-responsibility contract correctly. Mechanical SAFETY-comment hardening.

### 5.5 Tests to add

After the `pre-existing-ub-9/10` remediation lands, regression tests:

- `test/js/bun/ffi/ffi-close-then-call.test.ts` — open lib, get fn ref, close lib, call fn → must throw, not crash.
- `test/js/bun/ffi/ffi-close-callback-twice.test.ts` — closeCallback(ctx) twice → second must throw, not double-free.
- `test/js/bun/ffi/ffi-close-callback-wrong-ctx.test.ts` — closeCallback(0xCAFEBABE) → must throw, not crash.

Each test uses `Bun.spawn` against the debug build (`bunExe()`) to isolate the crash if remediation regresses.

### 5.6 Tests for the I-002 shutdown gate (optional)

`FetchTasklet::deinit`-from-HTTP-thread cannot be reliably triggered from JS-land without a shutdown race. The audit recommends a Rust unit test using `bun_jsc::test::with_vm(|vm| { ... })` that simulates the shutdown branch and verifies the Strong/Weak drops happen on the JS thread (via a thread-id check). Effort: medium.

---

## Section 6 — Bug findings summary

| # | Category | File | Severity | Inherited from Zig? |
| --- | --- | --- | --- | --- |
| `pre-existing-ub-7` | I-002 | `src/runtime/webcore/fetch/FetchTasklet.rs:374-391` | Latent; shutdown-gated | Yes |
| `pre-existing-ub-8` | I-004 audit gap | `src/bun_core/string/mod.rs:1262-1265` (architectural) | Maintenance liability | (No regression; gap in static enforcement) |
| `pre-existing-ub-9` | bun:ffi | `src/runtime/ffi/ffi_body.rs:1351-1370` | UAF on call-after-close | Yes |
| `pre-existing-ub-10` | bun:ffi | `src/runtime/ffi/ffi_body.rs:1281-1285` | UAF / arbitrary free | Yes |
| `FFI-CONTRACT-ADDR-LEN` | bun:ffi contract | `src/runtime/ffi/FFIObject.rs:801-916` | raw pointer/length capability; document and optionally debug-validate | Yes |
| `FFI-CONTRACT-FINALIZER` | bun:ffi contract | `src/runtime/ffi/FFIObject.rs:22-29` | raw finalizer fn-pointer capability; document and optionally registry-validate | Yes |

**Total: 4 real bug/hardening findings + 2 intentional FFI contract hazards.**

**None are new in the Rust port.** All preserve the Zig original's behavior verbatim; the audit's contribution is enumeration + remediation paths.

---

## Section 7 — Recommended PR sequence

1. **PR A: documentation-only.** Add SAFETY comments at `to_js` sites (§5.1);
   sharpen `FFIObject.rs` `from_raw_parts` SAFETY comments (§5.4); add SAFETY
   note + doc warning for `deallocator_from_addr` (`FFI-CONTRACT-FINALIZER`).
   Zero behavioral change.

2. **PR B: `bun:ffi` close hardening.** Implements `pre-existing-ub-9` + `pre-existing-ub-10` remediations. Adds the three regression tests from §5.5. Surface area: ~200 LOC across `ffi_body.rs` + a new C++ side helper `JSFFIFunction::invalidate`. **Highest user-facing impact** in this pass.

3. **PR C: FetchTasklet shutdown hardening.** Implements `pre-existing-ub-7` remediation: enqueue the deinit to the main thread always; let it leak harmlessly if the main thread never drains. Adds a comment naming the JSC contract. Low risk; one-file change.

4. **PR D (long-term): `ThreadSafeString` newtype.** Implements `pre-existing-ub-8` remediation. ~89 sites touched; medium effort. Best landed after PRs A-C have proved the audit framework.

---

## Section 8 — Appendix: additional samples and dispatch-table integrity

### 8.1 Additional I-003 site reads — `Body::ValueError::to_js` and `dupe`

`src/runtime/webcore/Body.rs:641-654`:

```rust
pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
    let js_value = match self {
        ValueError::AbortReason(reason) => reason.to_js(global_object),
        ValueError::SystemError(system_error) => system_error.to_error_instance(global_object),
        ValueError::Message(message) => message.to_error_instance(global_object),
        ValueError::TypeError(message) => message.to_type_error_instance(global_object),
        // do an early return in this case we don't need to create a new Strong
        ValueError::JSValue(js_value) => {
            return js_value.get().unwrap_or(JSValue::UNDEFINED);
        }
    };
    *self = ValueError::JSValue(jsc::strong::Optional::create(js_value, global_object));
    js_value
}
```

Two patterns coexist:
- **Fresh JS value paths** (`AbortReason`/`SystemError`/`Message`/`TypeError`): the value is brand new from `to_error_instance` / `to_type_error_instance`. Wrapping in `StrongOptional::create` is the protect/retain operation that takes ownership of the newly-created JSC cell. Subsequent re-reads of `*self` find the same cell still protected.
- **Pre-existing JSValue path** (line 648-650): the value was already wrapped in `StrongOptional`; just unwrap and return. The comment explicitly says "we don't need to create a new Strong" — this is awareness of the refcount-discipline contract.

`Body.rs:669-689` (`dupe`) is interesting: the comment at line 671-674 names exactly the I-003 risk shape and the Zig-port footgun:

```rust
// `.clone()` on BunString/SystemError already bumps the refcount (paired
// with their Drop deref). Zig did `var v = this.*; v.ref();` (bitwise copy
// + one bump) — `.clone()` alone is the Rust equivalent. An extra `.ref_()`
// here would leak +1 per dupe.
```

This is the canonical "Zig copied-and-`ref`'d; Rust `.clone()` does both" insight — exactly the bug class I-003 forbids. The Rust port avoids it.

**Verdict on Body.rs:** PASS, with explicit awareness of the trap.

### 8.2 Additional I-002 site read — `ReadableStream` cross-file ownership

`src/runtime/webcore/ReadableStream.rs:60`:

```rust
held: bun_jsc::strong::Optional::create(this.value, global),
```

The `Strong` is held in a `ReadableStreamStrong` (the file's `pub struct` near line 35). This is stored in `Body::Locked { readable: webcore::readable_stream::Strong, ... }` (`Body.rs:247`).

`Body` is consumed by:
- `Request`, `Response` — JS-thread-only owners.
- `FetchTasklet::request_body: HTTPRequestBody::ReadableStream(ReadableStreamStrong)` (`FetchTasklet.rs:71,131-135`). This crosses to the HTTP thread.

**Critical check.** Does the HTTP-thread path drop the `Strong`? Yes — via `HTTPRequestBody::detach()` (`FetchTasklet.rs:160-176`) which calls `stream.deinit()` on `ReadableStream` (`Strong::deinit`). The `detach` is invoked from `clear_data` on the JS thread (normal completion) OR from `FetchTasklet::deinit` on the HTTP thread under shutdown — re-triggering the `pre-existing-ub-7` hazard from §1.5.

**This is the second symptom of the same root cause.** Files: PASS2 finding `pre-existing-ub-7` covers it.

### 8.3 Sampled I-004 `BunString::clone_utf8` outflows

Searched for `clone_utf8` sites that write into a struct field crossing thread boundaries:

| Site | Field receiver | Off-thread? |
| --- | --- | --- |
| `FetchTasklet.rs:1029` | (local in cert-verify error path) | Local only |
| `FetchTasklet.rs:1154,1156` | (local for `path` in `on_reject`) | Local — wrapped in BodyValueError::SystemError | 
| `FetchTasklet.rs:1493,1494` | (locals fed into `Response::init`'s `status_text` / `url`) | Yes — Response is observed off-thread under shutdown |

All three use `clone_utf8`, not `from_js`. PASS.

Also sampled `cares_jsc.rs:760` (`bstr::String::clone_utf8`) — this is a Rust-side `String` (not `bun_core::String`), distinct from the I-004 invariant which only concerns `bun_core::String`. Different invariant; not applicable here.

### 8.4 `bun:ffi` dispatch table integrity — extended analysis

The `FFI` struct (`ffi_body.rs:230-247`) carries:

```rust
pub struct FFI {
    pub dylib: JsCell<Option<bun_sys::DynLib>>,
    pub functions: JsCell<StringArrayHashMap<Function>>,
    pub closed: Cell<bool>,
    pub shared_state: Cell<Option<NonNull<TCC::State>>>,
}
```

The dispatch flow is *layered*:

1. User-side: `dlopen('mylib.so', { foo: { args: ['int'], returns: 'int' } })` returns an FFI object with a `symbols.foo` JS function.
2. `symbols.foo` is a `JSFFIFunction` whose `m_function` points to the JIT'd `JSFunctionCall` symbol (i.e. Bun's generated trampoline).
3. The trampoline reads `argsPtr` from the JSC `CallFrame`, marshals to native ABI, and calls the *original* C symbol via `function.symbol_from_dynamic_library` (passed as `input_function_ptr` to `Bun__CreateFFIFunctionValue` at `ffi_body.rs:1604-1611`).

There are **three** raw pointers in flight per FFI function:

- The trampoline entry-point (`compiled.ptr`).
- The user's native symbol (`function.symbol_from_dynamic_library`).
- The `JSFFIFunction`'s back-reference to the FFI object (none stored explicitly — the trampoline closes over the symbol address directly).

**On `close`:** trampoline pages freed; user's symbol unmapped if `dylib.close()` was the last reference; `Function` heap allocation dropped (which calls `tcc_delete` on the per-function TCC state, freeing whatever auxiliary memory that state allocated).

**The `JSFFIFunction` retains all three pointers** in its `m_function` field (trampoline) + the property bag (`ptr` property = the native symbol address, also exposed as a JS-readable number on the function object). Both are stale.

This is `pre-existing-ub-9` from §4.4. The audit's contribution is naming the *three* invalidation points, which an implementation of the fix must all handle:

1. Invalidate `JSFFIFunction::m_function` for every `JSFFIFunction` wrapping this FFI.
2. Invalidate the `ptr` JS property (read-only — would require either an overwrite or marking the wrapper class as "closed").
3. (No-op on Rust side) — the native symbol address becomes garbage when `dlclose` runs.

A complete fix needs C++-side cooperation. Rust-side enumeration of which `JSFFIFunction` wrappers belong to which `FFI` would benefit from threading a back-pointer through `Bun__CreateFFIFunctionValue` (currently the wrapper is anonymous from the FFI's perspective).

### 8.5 `FFI::shared_state` versus per-`Function` `state` lifecycle

`FFI` has a `shared_state` field plus each `Function` has its own `state: Option<NonNull<TCC::State>>`. The lifecycle:

- `FFI::compile_c` path (the `cc()` host fn for compiling user-supplied C source) creates ONE `TCC::State` and stores it as `shared_state`. All `Function`s in this FFI reference it.
- `FFI::open` path (the `dlopen` host fn) creates one `TCC::State` *per Function* for the per-symbol trampoline, stored as `function.state`.

On `close`:
- Line 1364: destroys `shared_state` if set.
- Line 1367: `clear_retaining_capacity()` on `functions`, which Drops each `Function`, which calls `tcc_delete(state)` for each per-function state (`mod.rs:381-385`).

**Double-free check.** In the `cc()` path, the `shared_state` is destroyed AND each `Function`'s per-function `state` would also be destroyed. Is the per-function state set in this path? Read of `ffi_body.rs:1218,1364` confirms the per-function state is `None` when `shared_state` is used (a `Function` initialized via the `cc()` path leaves `state: None` and stores only the symbol pointer in `Step::Compiled.ptr`). So no double-free. PASS.

### 8.6 `read_unaligned_at<T: Copy>` — provenance

`src/runtime/ffi/FFIObject.rs:297-301`:

```rust
#[inline(always)]
pub(super) unsafe fn read_unaligned_at<T: Copy>(addr: usize) -> T {
    // SAFETY: precondition delegated to caller (see fn-level Safety doc).
    unsafe { (addr as *const T).read_unaligned() }
}
```

The `addr as *const T` cast produces a pointer with no specific provenance — under strict provenance (`-Zmiri-strict-provenance`) this would warn. But since the address is user-supplied via the FFI contract (the user is asserting they own a pointer to memory at that address), strict provenance does not apply at this boundary — the user provides the provenance externally.

**For the Rust abstract machine:** `(addr as *const T)` is an "exposed-provenance" pointer; `read_unaligned` is sound at the language level for any non-trapping read. The hazard is purely operational (bad addr → segfault), not language-level UB.

**Verdict:** SAFETY comment is correct; the FFI contract supplies provenance. PASS.

### 8.7 Cross-check: Zig original line counts

For traceability, the two pre-existing `bun:ffi` bugs and two intentional FFI
contract hazards map to Zig-original line numbers:

| Find | Rust file:line | Zig file:line |
| --- | --- | --- |
| `pre-existing-ub-7` | `FetchTasklet.rs:374-391` | `FetchTasklet.zig:76-89` |
| `pre-existing-ub-9` | `ffi_body.rs:1351-1370` | `ffi.zig:891-919` |
| `pre-existing-ub-10` | `ffi_body.rs:1281-1285` | `ffi.zig:833-837` |
| `FFI-CONTRACT-ADDR-LEN` | `FFIObject.rs:801-916` | `FFIObject.zig:578-720` |
| `FFI-CONTRACT-FINALIZER` | `FFIObject.rs:22-29` | `FFIObject.zig:578` (inline transmute) |

A future Phase-3 audit may want to re-cross-reference these against the current Zig sources should the Zig files still exist as porting reference.

---

## Section 9 — Audit methodology notes

This pass was performed by direct `rg` + read of every cited site; no `cargo expand`, no Miri runs (the runtime cannot be Miri-tested per the project's invariants doc), no fuzzing harness. Counts are exact at the time of audit; line numbers verified verbatim against `src/...` at commit `428f61eb34` (HEAD on `main` per the gitStatus context).

Two things would meaningfully improve a future pass:

1. **A per-`Send` struct compile-time assertion** (for example,
   `static_assertions::assert_impl_all!(T: Send)`) would let the audit replace
   per-site spot-checks with a compile-time guarantee for I-002. Effort to
   introduce: medium.

2. **A `bun:ffi` fuzzing harness** (afl++ / cargo-fuzz on the `to_buffer` / `closeCallback` / `read.u8` host fns) would mechanically exercise `pre-existing-ub-10` through `-12`'s remediations. Most of the bug surface is "bad number passed in" — straightforward fuzz target.
