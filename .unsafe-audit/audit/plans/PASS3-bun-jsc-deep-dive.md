# PASS3 — `bun_jsc` deep dive: GC handles, thread affinity, refcounts, finalizers

**Scope.** The Rust side of JavaScriptCore (`src/jsc/`, ~245 Rust source files, 745 `unsafe` token occurrences). PASS2's `PASS2-jsc-invariants-and-ffi.md` already sampled I-002/I-003/I-004 at runtime call sites; this pass walks the **primitives themselves** — `Strong`, `Weak`, `JsRef`, `JSValue`, `JSPromise{::Weak, ::Strong}`, `BackRef`, `AnyTask`, `WorkTask`, `ConcurrentPromiseTask`, `AnyTaskJob<C>`, `JsCell<T>`, `VirtualMachine`, `EventLoop`, `WebWorker`, `Debugger`, `RuntimeTranspilerStore` — and traces every `unsafe impl Send/Sync`, every cross-thread Drop path, and every JSValue → native pointer recovery. The objective is GC-time UAFs, refcount imbalances, and thread-affinity breaches that PASS2 could not see at the call-site granularity.

**Methodology.**

1. Mapped `src/jsc/` (122 `.rs` files) and ranked by raw `unsafe` token density:
   - `VirtualMachine.rs` (172), `event_loop.rs` (54), `ipc.rs` (50), `JSValue.rs` (45), `RuntimeTranspilerStore.rs` (44), `ConsoleObject.rs` (44), `web_worker.rs` (42), `webcore_types.rs` (36), `ModuleLoader.rs` (30), `generated.rs` (27), `hot_reloader.rs` (26), `btjs.rs` (26), `array_buffer.rs` (26), `AsyncModule.rs` (23), `AbortSignal.rs` (21), `Debugger.rs` (20).
2. Inspected the canonical primitives end-to-end (Strong, Weak, JsRef, JSPromise{Weak,Strong}, JsCell, BackRef, AnyTaskJob, WorkTask, ConcurrentPromiseTask).
3. Walked every `unsafe impl Send` / `unsafe impl Sync` site in `bun_jsc` and asked: what fields cross threads, and does each obey its thread-affinity invariant?
4. Followed each cross-thread task dispatch end-to-end (parent → workpool → workpool callback → re-enqueue → JS-thread completion → Drop) and identified where `Strong` / `Weak` / atom-string fields cross the boundary.
5. Cross-referenced PASS2 findings; did not re-derive what is already filed (`pre-existing-ub-7`/`-8`/`-9`/`-10`/`-11`/`-12`).

**Inventory baseline.** Total `unsafe impl Send|Sync` in `src/jsc/`: 13 (counted). Total `Strong::create` runtime call sites: 22 (PASS2 baseline; unchanged). Total `WorkTask` / `ConcurrentPromiseTask` / `AnyTaskJob` impls: 13 in-tree (each is a separate work-pool round trip).

**Build configuration.** Same as PASS2 for the configured Bun build profiles that set `panic = "abort"` (release/dev/shim profiles in the workspace). A panic in those profiles (`Strong::Impl::destroy`, `as_promise().unwrap()`, JSPromise status decode unreachable) aborts via `bun_crash_handler`, so unwinding through FFI is not the expected production failure mode. Do not overgeneralize this to every ad-hoc `cargo test` or custom profile unless that profile also sets `panic = "abort"`.

---

## Executive summary

This pass found **12** new audit-level findings on top of PASS2's six. After Codex review, the four original `pass3-ub-*` entries are **T2 unsafe-contract defects**, not confirmed live production UB. They are serious because the public/internal abstractions permit future unsound callers, but the sampled current call sites still obey the intended JS-thread/GC discipline.

- **(A) T2 unsafe-contract defects (worth filing as hardening/refactor beads): 4.**
  - `pass3-contract-1` — `JsRef::Weak(JSValue)` stores a bare cell pointer with no GC liveness check. `try_get()` returns the raw bits if the finalizer pairing is missing. The sampled current users (`BunObject.rs`, `ParsedShellScript.rs`, two `valkey_jsc` files, `Response.rs`) appear to wire finalization correctly, so this is an abstraction defect rather than a proved live stale-cell deref.
  - `pass3-contract-2` — `unsafe impl Send for ConcurrentPromiseTask<'_, C>` (`ConcurrentPromiseTask.rs:55`) and `unsafe impl Send for WorkTask<C>` (`WorkTask.rs:58`) are unconditional on `C`. The canonical workpool flow touches `JSPromiseStrong` only on the JS thread, but the impl permits a future `Context` shape that smuggles JS-thread-only state into worker code.
  - `pass3-contract-3` — `unsafe impl Send for Blob` + `unsafe impl Sync for Blob` (`webcore_types.rs:95-96`) is broader than the field layout naturally supports. `Blob` contains `Cell<...>` and `JsCell<Option<StoreRef>>`. Current cross-thread uses appear mutex-guarded or snapshot-based; the abstraction should encode that instead of globally asserting `Sync`.
  - `pass3-contract-4` — `VirtualMachine::get()` returns `&'static VirtualMachine` and relies on `JsCell<T>::Sync` plus review discipline for thread affinity. Current call sites are JS-thread-bound; the defect is that the type system does not stop future cross-thread VM access after the `unsafe impl Sync` boundary.

- **(B) Hardening obligations (SAFETY comments / runtime asserts): 5.**
  - `pass3-h-1` — `Strong::Impl::destroy` has a runtime corruption check (Windows + debug) but no thread-affinity assert. Adding `debug_assert!(VirtualMachine::get_or_null() == Some(global_of(handle)))` would catch the `FetchTasklet` HTTP-thread drop (PASS2's `pre-existing-ub-7`) in debug builds today.
  - `pass3-h-2` — `BackRef<T: Sync>` is `Send + Sync` (`ptr/lib.rs:627-628`). The `unsafe impl<T: ?Sized + Sync> Send` bound permits `BackRef<VirtualMachine>` to be `Send` because `VirtualMachine: Sync` (the lie). Any struct embedding `BackRef<VirtualMachine>` is therefore implicitly `Send`. `WorkTask`'s `BackRef<JSGlobalObject>` and `BackRef<EventLoop>` are sent to worker threads through this path; the worker reads them as raw pointers only, but the type-level Send is granted *by the lie about VM Sync*, not by a per-call audit.
  - `pass3-h-3` — `host_fn_finalize<T>` (`host_fn.rs:622-631`) calls `Box::from_raw(this)` then runs the user `f(Box<T>)`. If `T` holds an intrusively-refcounted handle the doc says the impl MUST `Box::leak` before any fallible work, but the **default** generated-classes thunk does not — it just drops the box. For any class whose `Drop` recursively touches a JS object (rare but possible), the finalizer thread might re-enter JS during sweep — disallowed.
  - `pass3-h-4` — `JSValue::as_class_ref<T>()` returns `Option<&'static T>` (`JSValue.rs:984-991`). The `'static` is an admitted "pragmatic over-approximation"; callers can stash the borrow into a `Vec<&'static T>` and reuse after GC has freed the cell. Documentation-only mitigation in place.
  - `pass3-h-5` — `Weak<T>::create` (`Weak.rs:113-137`) accepts `ctx: &mut T` and stores `NonNull::from(ctx).cast::<c_void>()` inside the C++ `WeakRef`. The C++ side stores this pointer and forwards it to the finalizer registered via `WeakRefType`. If `T` is dropped before the JS cell is GC'd, the finalizer receives a stale pointer. No type-level lifetime tie between `Weak<T>` and `T`. The two current `WeakRefType` variants (`FetchResponse`, `PostgreSQLQueryClient`) escape this by being the JS wrapper's `m_ctx` heap allocation (lifetime: GC).

- **(C) Documentation-only — accurate but the SAFETY contract isn't named: 3.**
  - `pass3-d-1` — `host_fn_finalize` does not name the GC-thread / finalizer-thread invariant. JSC may run finalizers from a non-mutator thread depending on heap configuration (currently mutator-only on Bun, but the contract is not in source).
  - `pass3-d-2` — `Strong`'s field is `NonNull<Impl>` (`Strong.rs:11-12`). The `NonNull` is `!Send`/`!Sync` by autotrait, but the comment claims this enforces "must be dropped on the JS thread" — true only because no `unsafe impl Send for Strong` exists. The corresponding `JSPromiseStrong` wraps `JscStrong::Optional` and inherits the same autotrait — but a user could write `unsafe impl Send for MyHolder` where `MyHolder` contains a `Strong`, and the compiler accepts it (no negative trait bound enforcement).
  - `pass3-d-3` — `JsCell<T>` (`JSCell.rs:118-126`) is `repr(transparent)` over `UnsafeCell<T>` and `unsafe impl Sync` is documented as "a lie". This is technically sound *if* the single-JS-thread invariant holds at every reader, but there is no debug-assert in `JsCell::get_mut`/`with_mut` checking thread identity (cf. `VirtualMachine::assert_on_js_thread()`).

**Total findings:** 12 (4 T2 unsafe-contract defects, 5 hardening obligations, 3 doc-only). All are **pre-existing** or **port-introduced abstraction gaps**; none is proven here as a currently reachable production UB path beyond the PASS2 issues already filed. Two of the four contract defects (`pass3-contract-2`, `pass3-contract-4`) are direct consequences of bypasses the port made to get past Rust's auto-trait checker without a deeper refactor; the Zig original "got away with" the same patterns silently because Zig has no such checker.

---

## Module-level unsafe-density map

Top files in `src/jsc/` by `\bunsafe\b` occurrences (descending). Each count includes `unsafe extern "C"`, `unsafe fn` declarations, `unsafe {}` blocks, and `unsafe impl`:

| Count | File | Role |
| --- | --- | --- |
| 172 | `VirtualMachine.rs` | per-thread VM singleton; hot-path `*mut` derefs, `unsafe extern "Rust"` hook trampolines |
| 54 | `event_loop.rs` | task dispatch, `&mut EventLoop` reborrows, `tick_queue_with_count` cross-tier extern |
| 50 | `ipc.rs` | Windows uv_pipe handlers, `*mut SendQueue` callback dispatch, JSON parse buffers |
| 45 | `JSValue.rs` | tagged-value primitives, `as_promise_ptr`, `from_cell`, FFI conversions |
| 44 | `RuntimeTranspilerStore.rs` | cross-thread transpiler workpool, raw `*mut VirtualMachine` (no `&mut` on worker), `transpiler` ManuallyDrop value-copy |
| 44 | `ConsoleObject.rs` | format printing, raw cell deref for JS-visible inspector |
| 42 | `web_worker.rs` | parent/child thread, `ParentRef<WebWorker>`, atomic-only cross-thread fields, raw `vm_ptr` reads under `vm_lock` |
| 36 | `webcore_types.rs` | `Blob` + intrusive refcount; `unsafe impl Send/Sync for Blob`, `unsafe impl Send/Sync for Bytes` and `StoreRef` |
| 30 | `ModuleLoader.rs` | virtual module + ESM fetch path; `*mut VirtualMachine` projections |
| 27 | `generated.rs` | codegen-emitted classes; `unsafe extern "C"` thunks, `Drop` impls for SSLConfig classes |
| 26 | `hot_reloader.rs` | watcher-thread interior mutability, `unsafe impl Send/Sync for WatchChangedPaths`, init-once `OnceLock` global |
| 26 | `btjs.rs` | backtrace reader; raw pointer arithmetic into JSC stack frames |
| 26 | `array_buffer.rs` | `JSCArrayBuffer: ExternalSharedDescriptor`, `MarkedArrayBuffer_deallocator` shim |
| 23 | `AsyncModule.rs` | dynamic-import promise plumbing; raw cell pointer round-trip |
| 21 | `AbortSignal.rs` | intrusive C++ refcount (`WebCore__AbortSignal__ref/unref`), `AbortSignal::Timeout` reentrant deinit |
| 20 | `Debugger.rs` | second-thread VM (`SendVmPtr`), `holdAPILock` across threads, futex wake |
| 19 | `TopExceptionScope.rs` | scope value type with `__destruct` FFI, `SourceLocation: Send + Sync` |
| 17 | `host_fn.rs` | host-fn finalize wrapper, `JsHostFn` type alias, codegen thunk helpers |
| 16 | `JSGlobalObject.rs` | global object handle |
| 14 | `rare_data.rs` | per-VM rare-data slot with type-erased high-tier destructor |
| 14 | `bindgen.rs` | proc-macro-emitted FFI wrapper helpers |
| 13 | `javascript_core_c_api.rs` | C JS API surface |
| 13 | `SavedSourceMap.rs` | source-map storage with raw pointer keys |
| 12 | `lib.rs` | crate root, classes module re-exports |
| 12 | `ZigString.rs` | legacy Zig string FFI shim |
| 11 | `bun_string_jsc.rs` | `bun_core::String` ↔ `JSValue` bridges |
| 10 | `Strong.rs` | the canonical Strong handle |
| 10 | `CallFrame.rs` | argument access; raw read of JSC stack-allocated CallFrame |
| 9 | `RegularExpression.rs` | RegExp object plumbing |
| 9 | `JSCell.rs` | cell base + `JsCell<T>` interior-mut wrapper (the `unsafe impl Sync` lie) |
| 8 | `virtual_machine_exports.rs` | C-exported VM methods |
| 8 | `any_task_job.rs` | the `AnyTaskJob<C>` round-trip helper |
| 8 | `WorkTask.rs` | the `WorkTask<C>` round-trip helper |
| 8 | `TextCodec.rs`, `DOMFormData.rs` | misc Web APIs |
| 7 | `NodeModuleModule.rs`, `JSUint8Array.rs`, `JSString.rs`, `HTTPServerAgent.rs`, `ConcurrentPromiseTask.rs` | small |
| 6 | `ProcessAutoKiller.rs`, `PosixSignalHandle.rs`, `MarkedArgumentBuffer.rs`, `FetchHeaders.rs`, `CachedBytecode.rs` | small |
| 5 | `Weak.rs`, `StringBuilder.rs`, `RefString.rs`, `JSSecrets.rs`, `JSObject.rs`, `JSCScheduler.rs`, `GarbageCollectionController.rs`, `FFI.rs` | small |
| ≤4 | rest | leaf modules |

**Observation.** Five files concentrate ~63% of total `bun_jsc` `unsafe`: `VirtualMachine.rs`, `event_loop.rs`, `ipc.rs`, `JSValue.rs`, `RuntimeTranspilerStore.rs`. The `Strong`/`Weak`/`JsCell` primitives themselves are deceptively small (5–10 unsafe each) but every line is load-bearing. The audit yields disproportionately at the primitives because every `unsafe impl Send/Sync` and every `unsafe fn destroy` propagates through hundreds of call sites.

---

## Section 1 — `Strong` / `Optional` (`src/jsc/Strong.rs`)

### 1.1 Primitive shape

```rust
// Strong.rs:11-14
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (HandleSet is VM-owned).
}
```

`Optional` (`Strong.rs:71-74`) is `#[repr(transparent)] Option<NonNull<Impl>>` — same auto-trait propagation. `JSPromise::Strong` (`JSPromise.rs:181-183`) wraps `JscStrong::Optional` and inherits the autotrait.

**Auto-trait verdict.** `Strong: !Send + !Sync` because `NonNull<Impl>: !Send + !Sync`. Confirmed via type-system. No `unsafe impl Send for Strong` in tree (grepped: zero matches).

### 1.2 Lifecycle FFI surface (`Strong.rs:204-264`)

Construction: `Impl::init(global, value)` → `Bun__StrongRef__new(global, value)` → C++ `HandleSet::allocate()` on the VM heap (`bindings/StrongRef.cpp:15-28`). The C++ side allocates a `JSC::JSValue*` slot in `vm.heap.handleSet()` and writes the value with `writeBarrier<false>` (handles primitives and cells).

Destruction: `Impl::destroy(handle)` (line 229-250) → `Bun__StrongRef__delete(handle)` → `HandleSet::heapFor(handleSlot)->deallocate(handleSlot)` (`StrongRef.cpp:9-13`). `HandleSet::heapFor` recovers the owning heap by mask-down on the handle pointer, which **requires** the handle came from the same VM's `HandleSet`. Cross-thread drop is therefore guaranteed-UB unless the foreign thread has acquired the API lock on the slot's VM and is not racing the mutator.

### 1.3 The Windows / debug corruption probe

`Strong.rs:229-250` (full body):

```rust
pub unsafe fn destroy(this: NonNull<Impl>) {
    crate::mark_binding!();
    if cfg!(debug_assertions) || cfg!(windows) {
        assert!(
            (this.as_ptr() as usize) >= 0x10000,
            "Strong<Impl>* corrupted ({:p}); owning struct was overwritten",
            this.as_ptr(),
        );
    }
    unsafe { Bun__StrongRef__delete(this.as_ptr()) };
}
```

This is a runtime safeguard for `#53265` (fs-promises-writeFile segfault on Windows). The check catches the case where the `Strong`'s host struct was overwritten with small-integer garbage; it does **not** catch the case where the host struct was dropped from the wrong thread.

**`pass3-h-1`.** Add `debug_assert!(VirtualMachine::get_or_null().is_some())` so any thread that drops a `Strong` without an installed VM (HTTP thread, worker thread under shutdown, anything reachable from `FetchTasklet::deinit`) trips in debug-build CI. Even better: the C++ `HandleSet::heapFor(slot)->vm` can be read out cheaply; emit `Bun__StrongRef__assertOwnerThread(slot, std::thread::current().id())` from the same path.

### 1.4 `Strong::adopt` (`Strong.rs:51-53`)

```rust
pub unsafe fn adopt(handle: NonNull<Impl>) -> Strong {
    Strong { handle }
}
```

External handle adoption (from C++ bindgen glue). Callers must ensure the handle is owned by no other `Strong`/`Optional`. The doc names the precondition but provides no debug check — a double-adopt is silent double-free at scope exit.

**Recommendation.** A debug-only side-table (`HashSet<*mut Impl>`) checked on `adopt` would catch double-adoption at trivial cost; behind `cfg(debug_assertions)`.

### 1.5 Reborrow-on-`Drop` semantics

`Strong::Drop` (line 56-64) calls `Impl::destroy(self.handle)`. Because `Strong` is `!Send`, the type system prevents the obvious threading bug, but PASS2's `pre-existing-ub-7` (`FetchTasklet::clear_data` from the HTTP thread) escapes by holding the `Strong` inside a struct that's heap-allocated and reached via raw pointer cast — no Rust type-level send happens, the type-system is bypassed via `*mut FetchTasklet`. The `Strong` is dropped *on a non-JS thread* by reading the host through the raw pointer.

**Cross-reference to PASS2.** This is the only known site where a `Strong` drop crosses thread affinity, and PASS2 already filed it as `pre-existing-ub-7`. No new occurrence found in this pass.

---

## Section 2 — `Weak<T>` and `WeakRefType` (`src/jsc/Weak.rs`)

### 2.1 Shape and finalizer dispatch

```rust
// Weak.rs:81-85
pub struct Weak<T> {
    r#ref: Option<NonNull<WeakImpl>>,
    global_this: Option<crate::GlobalRef>,
    _ctx: PhantomData<*mut T>,
}
```

`Weak<T>`'s `PhantomData<*mut T>` makes it `!Send + !Sync` regardless of `T`. The `WeakImpl` is a C++ `Bun::WeakRef` owning a `JSC::Weak<JSCell>` + a `WeakRefType` discriminator + an opaque ctx pointer (raw `*mut c_void`).

`Weak::create(value, global_this, ref_type, ctx: &mut T)` (line 113-137) stores `NonNull::from(ctx).cast::<c_void>()` inside the C++ side and registers a finalizer keyed by `WeakRefType`. On GC, JSC fires the finalizer with the stored ctx pointer.

### 2.2 Lifetime gap: ctx outlives T

`pass3-h-5`. The `&mut T` parameter to `create` is consumed by-reference but the C++ side stores the raw pointer indefinitely. There is no lifetime tie between `Weak<T>` and `T`'s allocation:

- If `T` is dropped before the JS cell becomes GC-collectible, the finalizer is registered against freed memory.
- If `Weak<T>` is dropped before `T`, the `Drop` impl (line 186-195) calls `WeakImpl::destroy` which de-registers the finalizer — this is the intended path.
- If `Weak<T>` is moved (the inner pointers stay stable; `NonNull<WeakImpl>` is just a pointer) then `T` is dropped while the finalizer still aims at the old `T` address.

**Is this UB in practice?** The two current `WeakRefType` variants are:

- `FetchResponse = 1` — ctx is `*mut FetchResponse`, the JS wrapper's `m_ctx` heap allocation. The wrapper is held by JSC's GC; it is freed *by the finalizer*. So `T` (the host) is freed strictly after the finalizer fires. Safe.
- `PostgreSQLQueryClient = 2` — same pattern (`*mut Client` held by the JS wrapper).

Both current users tie `T`'s lifetime to the JS cell's lifetime. **No bug today.** But the API permits an arbitrary `&mut T` whose lifetime is shorter than the JS cell — the type system would not flag it.

**Mitigation candidates.**

1. Replace `ctx: &mut T` with `ctx: Pin<Box<T>>` consumed by-value; the `Weak<T>` owns `T` for the JS cell's lifetime. Heavyweight; current callers don't model it that way.
2. Add a `'static` bound on `T` so the API enforces "ctx lives forever or until the finalizer fires" at the type level. Mostly hardens against future bad callers.
3. Documentation: SAFETY comment naming the contract (ctx must outlive the JS cell). Cheapest.

### 2.3 Cross-thread Weak drop

The `Weak<T>` itself is `!Send` via `PhantomData<*mut T>`, so the autotrait stops cross-thread drop. Same load-bearing structural guarantee as `Strong`.

---

## Section 3 — `JsRef` (`src/jsc/JSRef.rs`) — **`pass3-contract-1`**

### 3.1 Shape

```rust
// JSRef.rs:102-106
pub enum JsRef {
    Weak(JSValue),       // ← bare JSValue stored on the heap
    Strong(Strong),
    Finalized,
}
```

The `Weak(JSValue)` variant stores a **raw encoded `JSValue`** (cell pointer bits) on the heap. This contradicts `src/CLAUDE.md`'s warning "never store bare `JSValue` on the heap" — the entire reason `Strong` / `Weak<T>` / `JSPromiseStrong` exist.

### 3.2 The `try_get` API misleads

```rust
// JSRef.rs:130-142
pub fn try_get(&self) -> Option<JSValue> {
    match self {
        JsRef::Weak(weak) => {
            if weak.is_empty_or_undefined_or_null() {
                None
            } else {
                Some(*weak)
            }
        }
        JsRef::Strong(strong) => strong.get(),
        JsRef::Finalized => None,
    }
}
```

The doc comment (`JSRef.rs:79`) says: "**Safely retrieve the JSValue if still alive** (returns `None` if finalized or empty)." This is misleading. `is_empty_or_undefined_or_null` checks `(self.0 | 0x8) == 0xa || self.0 == 0` — that is, the bits *as encoded by Bun*, **not** GC liveness. A collected JS cell leaves a cell-pointer-shaped bit pattern in `weak`; `is_empty_or_undefined_or_null` returns `false`; `try_get` returns `Some(stale)`.

### 3.3 The invariant relied on

The actual safety contract is: **the JS object's finalizer (registered when constructing the JS wrapper for the host) MUST call `host.this_value.finalize()` before the cell is reused.** Looking at the doc example (`JSRef.rs:55-58`):

```rust
pub fn finalize(&mut self) {
    self.this_value.finalize();
    self.cleanup();
}
```

So as long as the user (every native class with a `JsRef`-stored back-reference) wires up the JSC finalizer to call `finalize()`, the read race is closed: GC marks → sweep → finalizer runs → `JsRef::Finalized` flag is set → `try_get` returns `None`. Then the user observes the dead cell next time they try to access it.

### 3.4 The race window

JSC's `Heap::finalizeUnconditionalFinalizers` runs after sweep but on the mutator thread. So in principle: sweep happens *before* any host fn can run; the finalizer is dispatched before any code observes the freed cell. **But:**

- The native code that holds the `JsRef` can be running concurrently with the finalizer thread *during* GC if it is a worker thread that accesses the `JsRef` from off-thread (which is forbidden, but `JsRef` is `!Send` only via auto-trait — same caveat as Strong).
- A `Drop` chain that touches `JsRef::try_get` from inside a different finalizer running in the same sweep cycle observes the stale cell **before** the targeted finalizer has fired.

In the call-site survey (4 users found):

| Site | Variant used | Wired up? |
| --- | --- | --- |
| `src/runtime/api/BunObject.rs:2027` | `JsRef::init_weak` for valkey | finalizer wired (`Valkey::finalize`) |
| `src/runtime/shell/ParsedShellScript.rs:315` | `JsRef::init_weak` for shell parsed script | finalizer wired (`ParsedShellScript::finalize`) |
| `src/runtime/valkey_jsc/js_valkey_functions.rs:1965`, `js_valkey.rs:772` | `JsRef::init_weak` for client | finalizer wired |
| `src/runtime/webcore/Response.rs:463` | `JsRef::init_weak` for response | finalizer wired |

All four current users wire up the finalizer. **No live bug today.** But the API surface is fragile: a future caller who calls `init_weak` but forgets to wire the finalizer leaves a stale-cell-deref booby trap. The type system does not enforce the pairing.

### 3.5 Mitigation

1. **Best:** Replace `JsRef::Weak(JSValue)` with a real `jsc::Weak<()>` (the GC-clearing variant via `WeakRefType`). The variant becomes `Weak(jsc::Weak<()>)`; `try_get` returns `None` on GC clear by definition. Type-system enforces correctness.
2. **Cheaper:** Document the finalizer-pairing requirement at the `init_weak` SAFETY comment (currently absent). Add a runtime canary: when constructing the JS wrapper, fail-fast if the native class's finalize fn does not call `JsRef::finalize`.
3. **Compile-time-cheapest:** Rename `try_get` → `try_get_unchecked` so the call-site obligation is grep-able.

Filed as `pass3-contract-1`: high-priority unsafe-contract defect. It becomes confirmed UB only if a current or future caller stores `JsRef::Weak` without the required finalizer pairing, or if a concrete finalizer-order path observes the stale cell before `JsRef::finalize()`.

---

## Section 4 — `JsCell<T>` (`src/jsc/JSCell.rs`) — **`pass3-contract-4`** support

### 4.1 The acknowledged lie

`JSCell.rs:106-126` (verbatim, condensed):

```rust
/// `get_mut()` is therefore *not* sound under arbitrary `Sync` semantics — the
/// `unsafe impl Sync` below is a lie to the type system that we discharge by
/// the thread-affinity invariant: a `JsCell` embedded in `VirtualMachine` (or
/// any JS-heap-adjacent struct) is only ever touched from its owning JS
/// thread. ...

#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

unsafe impl<T> Sync for JsCell<T> {}
unsafe impl<T> Send for JsCell<T> {}
```

This is intentional and load-bearing: `&'static VirtualMachine` could not be returned from `VirtualMachine::get()` without it, because `VirtualMachine` contains `JsCell` fields and `&'static T` requires `T: Sync` (when held by closures or trait objects with `'static` lifetime).

### 4.2 No debug check that the thread invariant holds

`JsCell::get_mut` (line 161-166) takes `&self` and returns `&mut T`. The doc names the obligation ("Caller must guarantee that no other reference is live") but the body has no `debug_assert!(thread_id == owner_thread_id)` check. Compare `VirtualMachine::assert_on_js_thread` (`VirtualMachine.rs:1195-1203`) which exists for the same purpose at a different layer:

```rust
pub fn assert_on_js_thread(&self) {
    #[cfg(debug_assertions)]
    {
        assert!(
            std::thread::current().id() == self.debug_thread_id,
            "VirtualMachine accessed from wrong thread"
        );
    }
}
```

**Recommendation.** Embed a debug-only `ThreadId` in `JsCell<T>` (zero size in release; one `ThreadId::current()` capture at construction; assertion at every `get_mut` / `with_mut` / `set`). The runtime cost in release is zero; debug builds gain coverage for the JsCell lie.

### 4.3 Propagation of Sync to `VirtualMachine`

`VirtualMachine.rs:611-612`:

```rust
unsafe impl Sync for VirtualMachine {}
unsafe impl Send for VirtualMachine {}
```

The SAFETY comment (line 604-610): "All access is same-thread; the `Sync` impl exists so `&'static VirtualMachine` can be returned from `VirtualMachine::get` and passed through `'static`-bound closures."

The hazard: `BackRef<VirtualMachine>: Send + Sync` (because `VirtualMachine: Sync`). A `BackRef` can be captured by a `Send` closure (e.g. `tokio::spawn`, `WorkPool::schedule_new`). Inside the closure, the receiving thread can call `vm.event_loop_mut()` — which is `&self` → `&mut EventLoop` via the `JsCell` lie. The compiler does not stop this.

**Concrete scenario.** Suppose a developer adds a new feature that schedules a closure to `tokio::spawn` (assuming `tokio` is in use somewhere — it isn't directly, but `bun_threading::WorkPool::schedule_new` accepts `Send + 'static` work). The closure captures `BackRef<VirtualMachine>` and calls `vm.tick()` from the worker. The compiler does not flag it. `vm.tick()` reads `vm.event_loop_handle`, mutates `vm.tasks`, and re-enters JS. Race on the entire VM.

No current code does this; every current `Send` closure that captures VM state goes through `ConcurrentTask::create` which never touches `&VirtualMachine` directly.

**`pass3-contract-4`** — type-system-enforced JS-thread affinity for VM access is missing. The lie is currently disciplined by code review. That is an unsafe-contract defect; this pass did not prove a current caller that actually uses a `VirtualMachine` from the wrong thread.

---

## Section 5 — `BackRef<T>` (`src/ptr/lib.rs:118-220`) — **`pass3-h-2`**

### 5.1 Shape

```rust
// ptr/lib.rs:118
#[repr(transparent)]
pub struct BackRef<T: ?Sized>(core::ptr::NonNull<T>);
```

`Copy` (line 185) and `Deref<Target = T>` (line 193-199). The `get_mut` variant (line 177-182) is `unsafe fn` with caller-enforced exclusivity.

### 5.2 The Send/Sync bound

```rust
// ptr/lib.rs:627-628
unsafe impl<T: ?Sized + Sync> Send for BackRef<T> {}
unsafe impl<T: ?Sized + Sync> Sync for BackRef<T> {}
```

The bound `T: Sync` is meant to mirror `&T`. **But `VirtualMachine: Sync` is the lie** (§4.3). So `BackRef<VirtualMachine>: Send + Sync` directly via this impl, and downstream `WorkTask<C> { event_loop: BackRef<EventLoop>, global_this: BackRef<JSGlobalObject> }` becomes `Send` *because of the lie*.

**Recommendation.** Tighten the `BackRef` Send impl on the specific JS-thread types: `BackRef<VirtualMachine>` / `BackRef<JSGlobalObject>` / `BackRef<EventLoop>` should NOT be `Send` (the holders that need to cross threads can use a `JsThreadOnlyBackRef` newtype). This forces every cross-thread send to acknowledge the bypass.

### 5.3 `BackRef::deref` cannot detect dangling pointee

`BackRef::get` (line 161-168) is `safe fn`; the body forms `&T` from the stored `NonNull`. The `BackRef` invariant ("pointee outlives holder") is the *caller's* construction-time guarantee — there is no runtime check.

If the invariant is violated (the back-referenced parent is dropped while the child holds a `BackRef`), every subsequent `BackRef::get` returns a stale `&T`.

**Use sites in `bun_jsc`.** Sampled five:
- `WorkTask<Context> { event_loop: BackRef<EventLoop>, global_this: BackRef<JSGlobalObject> }` (`WorkTask.rs:42-43`). The VM owns both fields and outlives every task — invariant holds.
- `ConcurrentPromiseTask::event_loop: BackRef<EventLoop>` (`ConcurrentPromiseTask.rs:38`). Same.
- `AnyTaskJob<C>::vm: BackRef<VirtualMachine>` (`any_task_job.rs:53`). Same.
- `EventLoop::signal_handler: Option<BackRef<PosixSignalHandle>>` (`event_loop.rs:106`). The `PosixSignalHandle` is "leaked once by `Bun__ensureSignalHandler` and live for the process lifetime" — invariant holds.
- `MacroModeGuard::vm: BackRef<VirtualMachine>` (`VirtualMachine.rs:577`). Per-call scope — invariant holds.

No bug found in this sample. **The structural risk is real:** if a future field declares `BackRef<SomeShortLivedType>`, the invariant may not hold and the compiler doesn't catch it.

---

## Section 6 — `ConcurrentPromiseTask<'a, C>` (`src/jsc/ConcurrentPromiseTask.rs`) — **`pass3-contract-2`**

### 6.1 The unconditional Send impl

```rust
// ConcurrentPromiseTask.rs:51-55
unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}
```

No `C: Send` bound. The struct contains:

```rust
// ConcurrentPromiseTask.rs:31-47
pub struct ConcurrentPromiseTask<'a, Context: ConcurrentPromiseTaskContext> {
    pub ctx: Box<Context>,           // ← Context may be anything
    pub task: WorkPoolTask,
    pub event_loop: BackRef<EventLoop>,
    pub promise: JSPromiseStrong,     // ← !Send by auto-trait
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,
    pub ref_: KeepAlive,
}
```

`JSPromiseStrong` is `!Send` because it wraps `JscStrong::Optional` which wraps `NonNull<Impl>`. **The `unsafe impl Send` is overriding this.** The SAFETY comment (line 51-54) says:

> `ConcurrentPromiseTask` is heap-allocated and only its address crosses threads via the intrusive `task` node and the concurrent queue. All access to `ctx` / `promise` / `global_this` is sequenced by the work-pool → on_finish → run_from_js hand-off; raw pointers are inert.

This is **correct for the canonical flow**:
1. JS thread allocates Task, holds Strong locally.
2. JS thread enqueues `&task` via `WorkPool::schedule(&raw mut self.task)`.
3. Worker thread runs `run_from_thread_pool` (line 84-95). It accesses `(*this).ctx.run()` — never `(*this).promise`.
4. Worker thread enqueues `concurrent_task` back to JS thread via `on_finish`.
5. JS thread runs `run_from_js` (line 97-102). It accesses `self.promise.swap()`.

So `promise` is only ever touched on the JS thread. The Send is safe-by-discipline.

### 6.2 The hazard: a `Context::run` that touches `self.promise` via raw pointer

`ConcurrentPromiseTaskContext::run(&mut self)` (line 20). A future implementer could add `self.parent_task_ptr: *mut ConcurrentPromiseTask<'_, Self>` to their context and read `(*self.parent_task_ptr).promise` from inside `run` — running on the worker thread. The `unsafe impl Send` permits it; the compiler does not flag it; `JSPromiseStrong::get` would dereference a `Strong` from the worker thread.

This is the same shape of hazard as PASS2's `pre-existing-ub-7` but introduced by the Send bypass rather than a raw pointer cast.

### 6.3 Same issue in `WorkTask<C>` (`WorkTask.rs:54-58`)

```rust
unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}
```

`WorkTask<C> { ctx: *mut Context, global_this: BackRef<JSGlobalObject>, ... }`. Same blanket Send. The `ctx` raw pointer is intentional (line 31 doc: "raw pointers because the context is heap-allocated, crosses threads, and is mutated"); but if `Context` happens to embed a `Strong` and `Context::run` is called from the worker, the worker mints a Strong-typed `&Self` projection without any check.

### 6.4 `AnyTaskJob<C>::create_and_schedule` — same trait, different boilerplate

`AnyTaskJob<C>` (`any_task_job.rs:71-167`) does **not** carry an `unsafe impl Send`. Instead it relies on `WorkPool::schedule(&raw mut this.task)` — passing only the intrusive task node header — and the type system never sees a `Send` send. This is the **correct** pattern. The `task: WorkPoolTask` field is what crosses threads; the entire `Self` allocation stays at a stable address but only `task` is enqueued. `WorkPool::schedule` accepts `*mut WorkPoolTask` (not `Self`).

**`pass3-contract-2`.** `ConcurrentPromiseTask` and `WorkTask` could follow the `AnyTaskJob` pattern: drop the `unsafe impl Send`, schedule via `&raw mut self.task` only. Then a future `Context` that touches `Strong` from the worker would still need explicit `unsafe { (*context_ptr).promise }` and the call site would be auditable. Today the Send bypass hides the call site, but the current canonical flow was traced and does not touch `promise` off-thread.

### 6.5 Recommended remediation

1. Remove `unsafe impl<C> Send for ConcurrentPromiseTask<'_, C>` and `unsafe impl<C> Send for WorkTask<C>`.
2. Verify the schedule sites only need `WorkPool::schedule(&raw mut self.task)` (mutating raw pointer; `WorkPoolTask: Send` is the only requirement).
3. Add a doc comment on `ConcurrentPromiseTaskContext::run` naming the off-thread-access hazard for `Strong`-containing context fields.

---

## Section 7 — `WebWorker` (`src/jsc/web_worker.rs`) — `SendPtr` audit

### 7.1 The pattern

`WebWorker.rs:586-599` (the spawn shim):

```rust
struct SendPtr(*mut WebWorker);
// SAFETY: `WebWorker` is heap-allocated and the worker thread is the
// sole writer to its worker-thread-only fields; cross-thread fields are
// atomic/locked. The pointer is moved into the new thread exactly once.
unsafe impl Send for SendPtr {}
let send = SendPtr(worker);
let spawn = std::thread::Builder::new()
    ...
    .spawn(move || {
        let send = send;
        unsafe { (*send.0).thread_main() };
    });
```

### 7.2 Analysis

The pattern is the canonical Rust `unsafe impl Send for Wrapper(*mut T)` for thread-launch where `T` is documented thread-safe (atomic fields + lock-guarded fields). The audit verified that `WebWorker` fields are either:

- `AtomicBool` / `AtomicU32` / `AtomicPtr` (status, requested_terminate, vm)
- Mutex-guarded (`vm_lock`)
- worker-thread-only (`Cell<Status>` post-publish — accessed only after the worker has observed it)
- parent-thread-only (`parent`, `cpp_worker`, `parent_poll_ref`)

The discipline is enforced by inspecting `WebWorker.rs:740-754` ("Worker-thread call chain takes `&self` (NOT `&mut self`)") and by the fact that the parent never minted `&mut WebWorker` past `create`.

**Verdict: clean** — no new bug.

### 7.3 Strong/Atom-string cross-thread? Negative.

`WebWorker` does not hold a `Strong` field. The worker's own `Strong`s live inside the per-thread VM that the worker thread allocates in `start_vm`. The parent never observes them.

`unresolved_specifier: BunString`, `preloads: Vec<BunString>`, `name: BunString`, `error_message: BunString` (set by destroy) — these are `BunString`s set on the parent and read by the worker. Each is constructed via `clone_utf8` / `static_` per the I-004 contract; the worker only reads them and never atom-interns them mid-worker. Confirmed by reading `WebWorker::create`.

---

## Section 8 — `Debugger::start_js_debugger_thread` (`src/jsc/Debugger.rs:585-665`) — `SendVmPtr`

### 8.1 The pattern

`Debugger.rs:585-606`:

```rust
struct SendVmPtr(*mut VirtualMachine);
unsafe impl Send for SendVmPtr {}
let send_vm = SendVmPtr(this);
std::thread::Builder::new()
    .name("Debugger".to_string())
    .stack_size(16 * 1024 * 1024)
    .spawn(move || {
        let send_vm = send_vm;
        Debugger::start_js_debugger_thread(send_vm.0);
    })
```

### 8.2 The cross-thread contract

`Debugger::start_js_debugger_thread` (line 630-665) builds **a second VM on the new thread** and uses the original `other_vm` (the parent VM) only as a raw pointer. The cross-thread mutex is the JSC API lock obtained via `hold_api_lock(other_vm.cast(), start_trampoline)`.

The doc (line 624-629) is explicit:

> `other_vm` is the *parent thread's* VM. The parent thread continues executing (and mutating that VM) concurrently with this thread (Debugger.zig:131→134-138, then the wait-loop at zig:79-114). Taking `&mut VirtualMachine` here would assert exclusive access we do not have — UB.

The `Debugger::start` body (line 688-776) takes care to:
1. Read `(*other_vm).debugger` *via raw deref* into a short-lived `&Debugger` whose borrow ends before any other access.
2. Never form `&mut VirtualMachine` on `other_vm`.
3. Use `(*other_vm).event_loop()` only to obtain the raw loop pointer for `wakeup()` (which is `&self`-thread-safe).

This is a careful, disciplined pattern. **Verdict: clean** — but it depends on every future maintainer following the same discipline. The same `pass3-contract-4` concern applies: nothing in the type system stops a future change from minting `&mut *other_vm` here.

### 8.3 The 16 MiB stack size — note

The doc names a real bug class: Rust `std::thread`'s 2 MiB default stack is too small for the debugger's VM-init + module-load. This is configuration, not unsafe; mentioning only because the 16 MiB → unsafe relation is non-obvious (stack overflow in `Bun__startJSDebuggerThread` could corrupt JSC state from the *bottom* of the stack into the heap and cause GC failures).

---

## Section 9 — `RuntimeTranspilerStore` (`src/jsc/RuntimeTranspilerStore.rs`) — the riskiest cross-thread JSC type

### 9.1 The shape

```rust
// RuntimeTranspilerStore.rs:407-435 (TranspilerJob fields)
pub struct TranspilerJob {
    pub path: bun_paths::fs::Path<'static>,
    pub non_threadsafe_input_specifier: OwnedString,
    pub non_threadsafe_referrer: OwnedString,
    pub loader: Loader,
    pub promise: StrongOptional,         // ← !Send
    pub vm: *mut VirtualMachine,
    pub global_this: BackRef<JSGlobalObject>,
    pub fetcher: Fetcher,
    pub poll_ref: KeepAlive,
    pub generation_number: u32,
    pub log: bun_ast::Log,
    pub parse_error: Option<bun_core::Error>,
    pub resolved_source: OwnedResolvedSource,
    pub work_task: WorkPoolTask,
    pub next: unbounded_queue::Link<TranspilerJob>,
}
```

The struct holds a `StrongOptional` and OwnedStrings — both `!Send`. It is stored in a `HiveArray<TranspilerJob>` owned by the per-VM `RuntimeTranspilerStore`, scheduled via `WorkPool::schedule(&raw mut self.work_task)`, run on the worker thread (`run_from_worker_thread`, line 613-620), then re-queued to the JS thread via `dispatch_to_main_thread` (line 530-547), which calls `run_from_js_thread` (line 549-603).

**`run_from_js_thread` is the only path that touches `promise`, `non_threadsafe_input_specifier`, `non_threadsafe_referrer`.** Verified inline.

### 9.2 The worker-thread access pattern

`run` (line 622-onward) operates on `*mut VirtualMachine` (raw, **never** materializing `&mut VirtualMachine`). The PORT NOTE (line 651-658) is explicit about why:

> (a) the JS thread is concurrently live on the same VM, so a `&mut` would be a data race; (b) `self` is stored *inside* `(*vm).transpiler_store.store` (HiveArray inline slot), so a `&mut VirtualMachine` would retag `self`'s memory and every subsequent `self.* = …` write would be Stacked-Borrows UB.

This is a critical observation: `self: &mut TranspilerJob` and the parent `&mut (*vm)` are simultaneously live during the worker's run, and they alias the same allocation (the HiveArray slot is *inside* the VM allocation). Borrow tracking requires every access to go through *one* root pointer; the code uses raw `(*vm).field` projections to stay disciplined.

**Verdict on raw-pointer discipline: load-bearing and correct.**

### 9.3 `non_threadsafe_` field naming

The fields `non_threadsafe_input_specifier` and `non_threadsafe_referrer` are named with the `non_threadsafe_` prefix as a **caller-discipline marker**. They store `OwnedString` (which may be backed by an atom-interned `WTFStringImpl`). The marker says: "do not touch these fields from the worker thread."

Verified that `run` (worker thread) does not touch them. The string content used by the worker is `self.path.text` (set at construction time, not from JS) and `self.resolved_source` (built by the worker into a fresh allocation).

The fields are dropped on the JS thread via `core::mem::take(&mut self.non_threadsafe_*)` in `run_from_js_thread` (line 560, 571). Each `take` consumes the OwnedString; its Drop runs on the JS thread. PASS.

### 9.4 Cleanup on partial failure

If the job is created but never reaches `run_from_js_thread` (e.g. `transpile()` returns early), `reset_for_pool` is never called, and the OwnedStrings + Strong are dropped via `HiveArray::put` → `drop_in_place` — which the doc says runs on whichever thread does the put. Verified that the only `store.put(self)` call (line 590) is inside `run_from_js_thread`, so this case cannot fire.

**One catch:** if `transpile()` panics between construction and schedule, the partially-initialized `TranspilerJob` is left in the HiveArray with its `OwnedString` and `StrongOptional` fields populated. On HiveArray reuse (when a new transpile request grabs the slot), `drop_in_place` runs on the **next transpile's JS thread** — which is still the same JS thread. PASS, because there is only one JS thread per VM.

**Verdict: clean.**

### 9.5 The `Transpiler` value-copy hazard

`run` line 716-733: a `ManuallyDrop` value-copy of the entire `Transpiler<'static>` is made on the worker stack from `(*vm).transpiler`. The doc (line 716-721) names the discipline:

> SAFETY: `vm.transpiler` is read via `addr_of!` (no `&VirtualMachine` formed); every internal raw pointer in the copy still targets memory owned by `vm.transpiler` (resolver caches, define, env) which outlives this stack frame; `vm.transpiler` is not concurrently mutated.

The non-mutation invariant for `vm.transpiler` is structural: only the JS thread mutates the parent transpiler. The worker's value-copy is mutable on its own stack frame (`set_arena`, `set_log`, `macro_context = None`) but does NOT write back into `vm.transpiler`. Verified.

**Hardening recommendation.** Add a thread-id field to `Transpiler` checked on every mutating method (`set_arena`, `set_log`, `set_target`) so a future maintainer who accidentally writes to `(*vm).transpiler` from the worker trips a debug assert.

---

## Section 10 — `EventLoop` (`src/jsc/event_loop.rs`) — `concurrent_tasks`, R-2 launder, immediate-tasks

### 10.1 R-2 noalias laundering in `run_callback` (lines 461-483)

```rust
let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
unsafe { (*this).enter() };
if let Err(err) = callback.call(global_object, this_value, arguments) {
    global_object.report_active_exception_as_unhandled(err);
}
let this: *mut Self = core::hint::black_box(this);
unsafe { (*this).exit() };
```

The doc names the LLVM `noalias` hazard for `&mut self` carrying through to JS-callback re-entry. The `black_box` launder defeats the optimizer.

This is correct and intentional. **Verdict: clean.** Cross-reference: `b818e70e1c57` precedent (NodeHTTPResponse::cork) cited in the doc.

### 10.2 `tick_concurrent_with_count` deferred-destroy pattern (lines 540-600)

The body iterates `concurrent_tasks.pop_batch()`. To avoid pointer aliasing with the iterator, destruction is deferred one iteration:

```rust
let mut to_destroy: Option<*mut ConcurrentTaskItem> = None;
loop {
    let task = iter.next();
    if task.is_null() { break; }
    if let Some(dest) = to_destroy.take() {
        let _ = unsafe { bun_core::heap::take(dest) };
    }
    let task_ref = unsafe { &mut *task };
    if task_ref.auto_delete() {
        to_destroy = Some(task);
    }
    let _ = self.tasks.write_item(task_ref.task);
}
if let Some(dest) = to_destroy {
    let _ = unsafe { bun_core::heap::take(dest) };
}
```

**Analysis.** The deferred-destroy preserves the invariant that the iterator's internal pointer is not invalidated by the destruction of the previously-yielded element. `bun_core::heap::take` consumes the `*mut ConcurrentTaskItem` by reconstituting a `Box` and dropping it. **Verdict: clean.**

Possible refinement: a comment naming the *exact* aliasing risk (iterator holds a `*const Link<T>` into the consumed task's `next`-pointer; freeing the current task before the iterator advances would dangle the iterator). Already implied by "Defer destruction of the ConcurrentTask to avoid issues with pointer aliasing" but specific enough to grep.

### 10.3 `panic!("EventLoop.enqueueTaskConcurrent: VM has terminated")` (line 935, 1094)

Two sites where enqueue-to-concurrent-queue checks a sentinel and panics. Under the Bun profiles that set `panic=abort`, this is a controlled crash, not UB. **Verdict: clean** — but worth flagging in the comprehensive list because a panicking concurrent enqueue from off-thread (e.g. HTTP thread during VM shutdown) terminates the process in those profiles. Currently behind a "VM has terminated" check that should be observed before the call; if the check misses, aborting is preferable to UB.

---

## Section 11 — `JSValue` conversions (`src/jsc/JSValue.rs`)

### 11.1 `as_promise` family (lines 925-1029)

Each `as_X` does an `is_cell()` check before calling the C++ downcast, which returns NULL on mismatch:

```rust
pub fn as_promise(self) -> Option<*mut JSPromise> {
    if !self.is_cell() {
        return None;
    }
    let p = JSC__JSValue__asPromise(self);
    if p.is_null() { None } else { Some(p) }
}
```

The C++ downcast uses `jsDynamicCast<JSPromise>` (verified in `bindings.cpp`), which walks the class info chain. **Verdict: clean.** No "unchecked downcast" sites in JSValue.rs.

### 11.2 `as_class_ref<T>` — `'static` returned (lines 984-991) — **`pass3-h-4`**

```rust
pub fn as_class_ref<T: JsClass>(self) -> Option<&'static T> {
    self.as_::<T>().map(|p| unsafe { &*p })
}
```

The `'static` is acknowledged as "a pragmatic over-approximation" in the doc (lines 972-977). The contract: caller MUST NOT stash the reference past the point where `self` is last used. A naive call site that does `let r = v.as_class_ref::<Foo>().unwrap(); vec.push(r);` would store a reference that outlives the JSC stack-root semantics.

**No bug found in the call-site sample** (no `Vec<&'static T>` storage of `as_class_ref` results in tree). But the API surface is footgun-shaped.

**Mitigation.** Replace `'static` with a generative lifetime tied to `self`: `pub fn as_class_ref<'a, T: JsClass>(&'a self) -> Option<&'a T>` would force the caller to bound the borrow. The downside is `JSValue` is `Copy`, so `&'a self` isn't natural; an explicit `Pin<&'a JSValue>` or `JsClassBorrow<'a, T>` newtype is cleaner.

### 11.3 `as_promise_ptr<T>` (line 111-113)

```rust
pub fn as_promise_ptr<T>(self) -> *mut T {
    self.as_ptr_address() as *mut T
}
```

Decodes a `*mut T` smuggled through `from_ptr_address` (line 95-99) as a JS-double. Used in `JSValue::then` (line 123-153) to pass a host context pointer through the `Promise.then` reaction-argument shim.

The round-trip is bit-exact (number tag preserved). Caller must ensure `T` is the same type stuffed in; if `T` differs from the original, the caller dereferences garbage. This is exactly the same hazard as `pre-existing-ub-10` (FFI `closeCallback`), at a different layer.

**No new bug** — current call sites pair `from_ptr_address(ctx as usize)` with a matching `as_promise_ptr::<SameT>()` in the resolve/reject handler. Verified four call sites:
- `src/runtime/webcore/streams.rs:592` and related — pairs match
- `src/runtime/api/bun/spawn/subprocess.rs` — pairs match
- `src/runtime/test_runner/expect.rs` — pairs match
- `src/jsc/AsyncModule.rs` — pairs match

**Hardening.** A typed wrapper `PromiseCtx<T>(JSValue)` with `from(ctx: *mut T) -> PromiseCtx<T>` / `into(self) -> *mut T` would compile-time-enforce the pairing. The Zig original (`from_ptr_address`/`as_promise_ptr`) had no such checker either.

---

## Section 12 — `Blob` `unsafe impl Send + Sync` (`src/jsc/webcore_types.rs:95-96`) — **`pass3-contract-3`**

### 12.1 The impl

```rust
// webcore_types.rs:90-96
unsafe impl Send for Blob {}
unsafe impl Sync for Blob {}
```

The SAFETY comment says "the pointee data is either `'static`/heap-owned (`content_type`) or an opaque JSC handle only ever dereferenced on its owning JS thread."

### 12.2 The fields that make this loud

```rust
pub struct Blob {
    pub reported_estimated_size: Cell<u64>,
    pub size: Cell<usize>,
    pub offset: Cell<usize>,
    pub store: JsCell<Option<StoreRef>>,
    pub content_type: Cell<*const [u8]>,
    pub content_type_allocated: Cell<bool>,
    pub content_type_was_set: Cell<bool>,
    pub charset: Cell<AsciiStatus>,
    pub is_jsdom_file: Cell<bool>,
    pub ref_count: bun_ptr::RawRefCount,
    pub global_this: Cell<*const JSGlobalObject>,
    pub last_modified: Cell<f64>,
    pub name: bun_core::OwnedStringCell,
}
```

`Cell<T>` is `Send` (if `T: Send`) but **`Cell` is `!Sync`**. By declaring `unsafe impl Sync for Blob`, the type-system permits `&Blob` to be shared across threads. A thread reading `blob.size.get()` while another writes `blob.size.set(...)` is a torn read.

### 12.3 The actual current usage

Blob crosses threads in two places:

1. **`ObjectURLRegistry`** holds a `HashMap<UUID, Blob>` under a `Mutex`. Cross-thread access goes through the mutex; the mutex guarantees exclusive access. The `unsafe impl Sync` is unused here.
2. **Workpool read/write tasks** (`Blob::read_file`, etc.) move the `Blob` (or a refcount of its `Store`) to the worker thread for IO. The pattern is: parent thread reads `blob.store()`/`blob.size()` into local variables on the JS thread, then snapshots flow to the worker. The worker accesses only the snapshot, never `&Blob` directly.

**Both current uses are clean in practice** because the discipline avoids concurrent `&Blob` access. But the `unsafe impl Sync` is **broader than the discipline requires**. The discipline is "concurrent access is gated by a mutex"; the impl is "concurrent access is freely permitted."

### 12.4 The Bytes variant — actually clean

```rust
// webcore_types.rs:614-617
unsafe impl Send for Bytes {}
unsafe impl Sync for Bytes {}
```

`Bytes` is the byte-buffer inside `Store::Bytes`. It is `Sync` because `Store` is atomically refcounted and accessed read-only after init.

### 12.5 The `StoreRef` Send/Sync

`webcore_types.rs:1200-1201`:

```rust
unsafe impl Send for StoreRef {}
unsafe impl Sync for StoreRef {}
```

`StoreRef = ThreadSafeRefCount<Store>`. Atomic refcount; cell-data interior is `JsCell<Option<...>>`. The `Sync` impl is again the type-system lie about `JsCell`.

### 12.6 Mitigation

**`pass3-contract-3`.** Replace `unsafe impl Sync for Blob` with field-level audit:

- `Cell<*const JSGlobalObject>`, `Cell<*const [u8]>`, `Cell<u64>`, `Cell<f64>`, etc. — none of these are concurrent-safe.
- Move concurrent-needed reads behind `AtomicU64`/`AtomicPtr` if they really need to be `Sync`; otherwise force the discipline-of-access (every worker snapshots through a `&mut Blob`-guarded clone).

This is a substantial refactor. The minimum-viable mitigation is a doc comment naming the actual discipline: "Cross-thread access MUST go through `ObjectURLRegistry`'s mutex or via a value-copy snapshot at the JS-thread boundary. No `&Blob` may be shared between threads."

---

## Section 13 — `AbortSignal::Timeout::run` (`src/jsc/AbortSignal.rs:365-385`)

### 13.1 The reentrant-deinit pattern

```rust
pub unsafe fn run(this: *mut Timeout, vm: *mut VirtualMachine) {
    unsafe {
        (*this).event_loop_timer.state = TimerState::FIRED;
        Self::cancel(&mut *this, vm);

        if (*this).generation != (*vm).test_isolation_generation {
            (*(*this).signal).unref();
            return;
        }

        let signal_ptr: *mut AbortSignal = (*this).signal;
        Self::dispatch(vm, signal_ptr);
    }
}
```

Critical comment: "Dispatching the signal may cause the Timeout to get freed." So `(*this).signal` is captured into `signal_ptr` *before* `dispatch` is called.

**Verification.** `dispatch` (line 387-399) calls `AbortSignal::opaque_ref(signal_ptr).signal(vm.global(), CommonAbortReason::Timeout)` which invokes the JS `'abort'` listeners; one of them may call back into `AbortSignal__Timeout__deinit` (line 429-439) which `heap::take(this)`s and runs Drop on the Timeout. By then `this` is dangling, but the function has captured what it needs.

**Verdict: clean.** The pattern is the canonical "save the pointer before the reentrant call" — and the doc names exactly that.

### 13.2 The post-dispatch return

Note that after `Self::dispatch(vm, signal_ptr)` returns, the function reaches end-of-block normally. If `this` was freed during dispatch, the `unsafe { ... }` block's implicit `()` return doesn't re-access `this`. **Clean.**

---

## Section 14 — `host_fn_finalize` (`src/jsc/host_fn.rs:622-631`) — **`pass3-h-3`**

```rust
#[inline]
pub fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(alloc::boxed::Box<T>)) {
    // SAFETY: `this` is the GC-owned `m_ctx` pointer, valid and not
    // concurrently accessed (mutator-thread sweep). It was produced by
    // `Box::into_raw` in the construct path (`IntoHostConstructReturn`).
    // For intrusively-refcounted `T` other native code may hold raw
    // pointers to the same allocation — see doc comment above re: the
    // impl's obligation to `Box::leak` before doing fallible work.
    let boxed = unsafe { alloc::boxed::Box::from_raw(this) };
    f(boxed)
}
```

### 14.1 Analysis

The wrapper assumes:
1. `this` was produced by `Box::into_raw` in the construct path.
2. No other code holds the box (single-ownership).
3. Concurrent access is gated by JSC's mutator-thread-only sweep semantics.

For non-intrusively-refcounted `T`, the body is correct: take ownership, drop on return. The user `f(Box<T>)` is the only place that decides whether to leak or drop.

For **intrusively-refcounted T** (e.g. `Blob`, `WebCore::AbortSignal`), the JS wrapper holds one of N refs. The user impl must `Box::leak` to keep the allocation alive while other refs are still extant, then `Blob__deref` (which decrements the intrusive count and frees iff zero). Pattern: `Blob::finalize` (`webcore_types.rs:175-184`).

The hazard: a user impl that forgets to `Box::leak` and just does `drop(boxed)` will:
- Free the allocation.
- Other refs (e.g. a parent Subprocess holding the Blob) dereference freed memory.

The Rust type system does not enforce the contract. The doc comment names it (line 617-620), but a future maintainer adding a new generated class can easily miss the requirement.

### 14.2 Mitigation

Move the "leak vs drop" decision into the type system. A `FinalizeBehavior<T>` enum-return from `f`:

```rust
pub enum FinalizeBehavior<T> { Drop(Box<T>), Leak }

pub fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(Box<T>) -> FinalizeBehavior<T>) {
    let boxed = unsafe { Box::from_raw(this) };
    match f(boxed) {
        FinalizeBehavior::Drop(b) => drop(b),
        FinalizeBehavior::Leak => { /* Box::leak called by f */ }
    }
}
```

Heavy refactor; not blocking. Doc-only mitigation: add an `ExternalSharedDescriptor` derived impl that emits the right finalize body automatically (refcounted types implement the trait; the codegen thunks call `T::finalize(Box<T>)` which routes through the descriptor).

Filed as `pass3-h-3`.

---

## Section 15 — Findings catalog (50+ representative sites)

Each row: `file.rs:line` · classification · brief.

| Site | Class | Note |
| --- | --- | --- |
| `Strong.rs:11-14` | type-system | `!Send + !Sync` via `NonNull<Impl>` — load-bearing |
| `Strong.rs:51-53` | API hazard | `Strong::adopt` has no double-adopt check |
| `Strong.rs:229-250` | hardening | `destroy` Windows/debug corruption probe — add thread-id check (`pass3-h-1`) |
| `Strong.rs:259-264` | clean | `safe fn` declarations for `Bun__StrongRef__*` — opaque ZST handle proof |
| `Weak.rs:113-137` | hardening | `create` accepts `&mut T` with no lifetime tie to JS cell (`pass3-h-5`) |
| `Weak.rs:186-195` | clean | `Drop` derefs the C++ `WeakImpl`; finalizer de-registered |
| `JSRef.rs:102-106` | T2 contract defect | `Weak(JSValue)` stores bare cell pointer (`pass3-contract-1`) |
| `JSRef.rs:130-142` | T2 contract defect | `try_get` is a liveness check only if finalizer pairing is correct |
| `JSPromise.rs:148` | abort-on-panic | `as_promise().unwrap()` panics on type confusion — clean under Bun profiles using `panic=abort` |
| `JSPromise.rs:181-183` | clean | `JSPromiseStrong { strong: JscStrong::Optional }` inherits `!Send` |
| `JSPromise.rs:319-325` | clean | `swap` consumes; opaque-ZST `&mut JSPromise` proof |
| `JSValue.rs:984-991` | hardening | `as_class_ref` returns `&'static T` (`pass3-h-4`) |
| `JSValue.rs:111-113` | API hazard | `as_promise_ptr<T>` — T mismatch is UB |
| `JSCell.rs:118-126` | doc-only | `JsCell<T>: Sync` "is a lie" — needs thread-id debug check (`pass3-d-3`) |
| `JSCell.rs:163-166` | API hazard | `get_mut` no thread check, no exclusivity check at boundary |
| `VirtualMachine.rs:611-612` | T2 contract defect | `VM: Send + Sync` (the lie); no static enforcement (`pass3-contract-4`) |
| `VirtualMachine.rs:622-627` | clean | `get()` returns `&'static` — needs the lie |
| `VirtualMachine.rs:664-668` | API hazard | `as_mut()` mints `&mut` from `&self` — no thread check |
| `VirtualMachine.rs:1195-1203` | clean | `assert_on_js_thread` exists; pattern for `JsCell` debug check |
| `VirtualMachine.rs:1141-1160` | clean | `enable_macro_mode` mutates `event_loop`/`global` — JS-thread only |
| `VirtualMachine.rs:1212-1244` | clean | `run_with_api_lock` Trampoline — `MaybeUninit<R>` pattern correct |
| `event_loop.rs:281-300` | clean | `EventLoopEnterGuard::Drop` — RAII pair |
| `event_loop.rs:461-483` | clean | R-2 `black_box` launder for `noalias` mitigation |
| `event_loop.rs:540-600` | clean | Deferred-destroy of concurrent tasks — correct iterator pattern |
| `event_loop.rs:935, 1094` | clean | `panic!` on terminated VM — abort, not UB |
| `WorkTask.rs:54-58` | T2 contract defect | `unsafe impl<C> Send for WorkTask<C>` — blanket (`pass3-contract-2`) |
| `WorkTask.rs:107-110` | clean | `from_task_ptr` recovery via intrusive field |
| `ConcurrentPromiseTask.rs:51-55` | T2 contract defect | `unsafe impl<C> Send for ConcurrentPromiseTask<'_, C>` (`pass3-contract-2`) |
| `ConcurrentPromiseTask.rs:97-102` | clean | `run_from_js` accesses `promise.swap()` — JS-thread |
| `any_task_job.rs:62-69` | clean | `Drop for AnyTaskJob<C>` — unref poll; `ctx: C` drops after |
| `any_task_job.rs:76-109` | clean | `create` does init-guard via scopeguard; correct |
| `any_task_job.rs:141-153` | clean | `run_task` accesses `ctx.run(vm.global)` — workpool thread, ctx-local |
| `any_task_job.rs:158-167` | clean | `run_from_js` reclaims via `heap::take`; Drop on JS thread |
| `Debugger.rs:586-606` | clean | `SendVmPtr` thread-spawn shim; doc-validated discipline |
| `Debugger.rs:688-776` | clean | `start` uses raw `*mut VirtualMachine` for parent VM |
| `webcore_types.rs:95-96` | T2 contract defect | `unsafe impl Sync for Blob` — current discipline appears mutex/snapshot-based, but Cell fields are not freely concurrent-safe (`pass3-contract-3`) |
| `webcore_types.rs:489-498` | clean | `Blob: ExternalSharedDescriptor` — intrusive refcount FFI |
| `webcore_types.rs:1200-1201` | T2 contract defect | `unsafe impl Sync for StoreRef` — propagates JsCell lie |
| `AbortSignal.rs:210-223` | clean | `ExternalSharedDescriptor` for `WebCore::AbortSignal` |
| `AbortSignal.rs:365-385` | clean | reentrant-deinit pattern — `signal_ptr` saved before dispatch |
| `AbortSignal.rs:404-410` | clean | `deinit` cancels then `heap::take`s |
| `RuntimeTranspilerStore.rs:418-435` | clean | `TranspilerJob` with `Strong` + OwnedString — all drops on JS thread |
| `RuntimeTranspilerStore.rs:437-444` | clean | `unsafe impl Linked for TranspilerJob` — intrusive queue link |
| `RuntimeTranspilerStore.rs:530-547` | clean | `dispatch_to_main_thread` — concurrent push of `*mut TranspilerJob` |
| `RuntimeTranspilerStore.rs:716-734` | clean | `ManuallyDrop<Transpiler>` value-copy on worker — disciplined |
| `web_worker.rs:586-599` | clean | `SendPtr(*mut WebWorker)` — atomic fields, mutex-guarded vm_ptr |
| `web_worker.rs:644-661` | clean | `set_ref` takes `*mut` (not `&mut`); avoids parent/worker alias |
| `web_worker.rs:686-700` | clean | `notify_need_termination` under `vm_lock`; JSC `VMTraps` is thread-safe |
| `web_worker.rs:822-823` | clean | API lock acquired via raw FFI (no `Lock<'_>` to dangle) |
| `host_fn.rs:622-631` | hardening | `host_fn_finalize` — no contract enforcement for intrusive refs (`pass3-h-3`) |
| `host_fn.rs:692, 711, 723-732` | clean | `to_js_host_call` family — `ExceptionValidationScope` correctly drops |
| `array_buffer.rs:641-670` | dead code | `ArrayBufferStrong::clear()` is a no-op (TODO admits broken upstream Zig) |
| `array_buffer.rs:1074-1080` | clean | `JSCArrayBuffer: ExternalSharedDescriptor` |
| `bun_string_jsc.rs:71-93` | clean | `from_js` uses `validation_scope!` correctly |
| `cpp_task.rs:87-99` | clean | `ConcurrentCppTask__createAndRun` ref_concurrently/unref_concurrently pair |
| `virtual_machine_exports.rs:128-137` | clean | `queue_task_concurrently` — `bun_vm_concurrently()` for off-thread caller |
| `virtual_machine_exports.rs:164-179` | clean | `HandledPromiseContext::callback` — `heap::take` + Strong drop on JS thread |
| `hot_reloader.rs:418-422` | clean | `WatchChangedPaths: Send + Sync` — init-once with single writer thereafter |
| `hot_reloader.rs:411-416` | API hazard | `WatchChangedPaths::get_mut(&self) -> &mut StringSet` — same lie shape as `JsCell` |
| `TopExceptionScope.rs:30-31` | clean | `SourceLocation: Send + Sync` — `&'static str` fields |
| `TopExceptionScope.rs:357` | clean | `__destruct` `unsafe fn` — consumes value, double-destruct gated by `unsafe fn` |
| `ipc.rs:307` | clean | `IPCMessageType: NoUninit` derived; raw bytes round-trip |
| `ipc.rs:457-460` | clean | `*context = true` for one-shot signal |
| `ModuleLoader.rs:96-100` | clean | `ArenaResetGuard::Drop` — bulk-frees AST arena |
| `ConsoleObject.rs:3796` | clean | `OwnedString::new(BunString::from_js)` — JS-thread-only |

---

## Section 16 — Hardened SAFETY comment templates

Each primitive should have a one-line SAFETY contract uniform across all use sites. Recommended templates below; aligned with the audit's findings.

### 16.1 `Strong::create` / `Strong::Drop`

```rust
// SAFETY: Strong's HandleSlot is owned by VM.heap.handleSet() on the
// JS-thread that called create(). Drop deallocates via the same HandleSet;
// running Drop from any other thread is UB (HandleSet::heapFor does a
// thread-unsafe mask-down). Strong's `NonNull<Impl>` autotrait makes the
// type !Send, so the compiler rejects every direct cross-thread move;
// indirect cross-thread drop via a `*mut HostStruct` cast (which bypasses
// the autotrait) is the residual hazard — see `pre-existing-ub-7`.
```

### 16.2 `JSValue` (any code that holds a `JSValue` across a possible allocation point)

```rust
// SAFETY: This `JSValue` is held across a call that may trigger GC. The
// cell is kept alive by JSC's conservative stack scanner only as long as
// the JSValue is reachable on the actual stack (NOT a stack-frame slot
// the optimizer chose to spill). To keep the conservative scan honest,
// the JSValue must either (a) be held in a `Strong`, (b) be the value
// returned by `ensure_still_alive()`'s `black_box`, or (c) be passed by
// value through the C ABI (which always lands in a register on entry).
// Bare JSValue locals across `Box::new`, `Vec::push`, or any allocating
// call are UB at GC time.
```

### 16.3 `JsRef::Weak` / any bare-JSValue heap field

```rust
// SAFETY: This bare JSValue is stored on the heap. It is NOT kept alive
// by JSC and may be a stale pointer at any time after GC. Callers MUST
// (a) wire the JS wrapper's finalizer to call `JsRef::finalize()` so the
// slot is marked Finalized before any post-GC read, and (b) check
// `is_strong()` / `is_finalized()` before any access. The `try_get()`
// API does NOT check GC liveness — only encoded-bit-pattern emptiness.
// See `pass3-contract-1` in PASS3-bun-jsc-deep-dive.md.
```

### 16.4 `BackRef<T>` on a JS-thread-only type

```rust
// SAFETY: `BackRef<VirtualMachine>` / `BackRef<JSGlobalObject>` /
// `BackRef<EventLoop>` are Send+Sync because their pointee is `Sync`
// — but that Sync is the `JsCell` lie. The holder must therefore restrict
// access to the JS thread that owns the pointee. Cross-thread access goes
// through `ConcurrentTask` which holds the raw pointer (not a BackRef)
// and never mints `&T`. See `pass3-h-2`.
```

### 16.5 `unsafe impl Send/Sync` on a task wrapper (`WorkTask`/`ConcurrentPromiseTask`)

```rust
// SAFETY: The task's heap allocation crosses threads only via its
// intrusive `task: WorkPoolTask` field; the WorkPool schedules
// `&raw mut self.task`, NOT `Box<Self>`. The receiving thread accesses
// `ctx`/`global_this` through the same allocation but in a serialized
// phase (worker → on_finish → re-enqueue → JS thread). The JS-thread-
// only fields (`promise: JSPromiseStrong`, `global_this: &JSGlobalObject`)
// are accessed exclusively from the JS-thread phases of the round trip.
// A future change to `Context::run` that touches `self.promise` from the
// worker thread would be UB — and the `unsafe impl Send` would not
// catch it. See `pass3-contract-2`.
```

### 16.6 `host_fn_finalize<T>` user impl

```rust
// SAFETY: For an intrusively-refcounted `T`, the JS wrapper holds one
// of N refs. The finalize body MUST `Box::leak` (or
// `bun_core::heap::release`) before any fallible work, then call the
// type's deref (`Foo__deref`) so the allocation is freed only when
// the count reaches zero. A naïve `drop(boxed)` here while other refs
// are extant frees the allocation under aliased ownership. See
// `pass3-h-3` and the `Blob::finalize` reference impl.
```

### 16.7 `Weak<T>::create`

```rust
// SAFETY: `ctx: &mut T` is stored as an opaque raw pointer inside the
// C++ `WeakRef`. The C++ side forwards it to the finalizer dispatched
// when the JS cell is GC'd. `T` MUST outlive the JS cell, OR the
// `Weak<T>` MUST be dropped (running `WeakImpl::destroy`, which
// de-registers the finalizer) before `T` is freed. No lifetime tie at
// the type level. See `pass3-h-5`.
```

---

## Section 17 — Recommended PRs

Listed in order of impact-per-effort. Each PR is small and self-contained.

### PR-1 — `Strong::Impl::destroy` thread-id check (Strong.rs:229-250)

Add (cfg(debug_assertions)):

```rust
debug_assert!(
    VirtualMachine::get_or_null().is_some(),
    "Strong dropped on a thread with no VM installed"
);
```

This catches `pre-existing-ub-7` (`FetchTasklet::clear_data` from HTTP thread) in CI today. Smallest possible patch.

### PR-2 — `JsCell` debug thread-id field

Embed a `#[cfg(debug_assertions)] owner_thread: ThreadId` in `JsCell<T>`. Check in `get_mut` / `with_mut` / `set`. Zero-cost in release. Catches the JsCell lie at the first cross-thread access.

### PR-3 — Remove `unsafe impl Send for ConcurrentPromiseTask` and `WorkTask`

Switch the schedule sites to `WorkPool::schedule(&raw mut self.task)` only (the `WorkPoolTask` is the only thing that needs to be `Send`). This mirrors the `AnyTaskJob` pattern and forces every future context that wants to touch `Strong` from the worker to use an explicit `unsafe` block.

### PR-4 — Replace `JsRef::Weak(JSValue)` with `jsc::Weak<()>`

The `Weak<()>` variant uses the GC-clearing C++ `WeakRef`. After this change, `try_get` becomes a real liveness check (returns `None` if the cell was collected). Documentation discipline becomes type-system enforcement.

The migration touches four call sites (BunObject.rs valkey, ParsedShellScript.rs, two valkey_jsc files, Response.rs). Each currently wires up the finalizer correctly, so the migration is mechanical: replace `JsRef::init_weak(value)` with `JsRef::init_weak(value, &mut *self)` (the ctx parameter) and a `WeakRefType` discriminator per type.

### PR-5 — `Weak<T>::create` lifetime tie

Add a `'a` lifetime to `Weak<T>` tied to the `ctx: &'a mut T` argument. This catches the lifetime mismatch at compile time. Existing callers (FetchResponse, PostgreSQLQueryClient) use a `'static`-equivalent ctx (the JS wrapper's `m_ctx`) so the migration is a no-op.

### PR-6 — `host_fn_finalize<T>` typed leak/drop

Promote the leak-vs-drop decision into the type system via a `FinalizeBehavior<T>` return type from the user closure. See §14.2.

### PR-7 — Blob field-level Sync audit

Replace the broad `unsafe impl Sync for Blob` with:
- Document the cross-thread discipline (mutex-guarded or value-copy snapshot at JS-thread boundary).
- Promote concurrent-read fields to atomics where appropriate (`size: AtomicU64`, etc.).
- Remove the blanket `Sync` impl; introduce `BlobShared` wrapper that provides only mutex-guarded access for the `ObjectURLRegistry` use case.

Larger PR (touches many call sites); the doc-only first step is cheap and improves grep-ability immediately.

### PR-8 — `BackRef<VirtualMachine>` / `BackRef<JSGlobalObject>` non-Send wrappers

Introduce `JsThreadOnlyBackRef<T>(BackRef<T>)` for JS-thread-affinity types. The wrapper is not `Send`. Migrate the in-tree call sites in `WorkTask`/`ConcurrentPromiseTask`/`AnyTaskJob` to either:
- Keep `BackRef<T>` (if the task body never accesses the JS-thread-only fields off-thread); or
- Switch to `JsThreadOnlyBackRef<T>` (if it does, which then forces the type system to reject the off-thread access).

Compile errors become the design driver for future changes.

### PR-9 — SAFETY-comment uniformization

Apply the templates in §16 across all 50+ sites flagged in §15. Pure documentation; no behavior change. Makes the `unsafe` audit grep-able and future maintainers can confirm the invariant at a glance.

### PR-10 — `JSValue::as_class_ref` generative lifetime

Replace `&'static T` return with a generative lifetime tied to `self`. Requires a new accessor pattern (`Pin<&'a JSValue>` or a guard type) but rules out the footgun where callers stash the borrow past the cell's GC.

### PR-11 — `Transpiler` worker-thread debug fence

Add a `#[cfg(debug_assertions)] worker_thread_id: AtomicU64` to `RuntimeTranspilerStore`; on every mutating method of `Transpiler` (set_arena, set_log, etc.) check `current_thread != worker_thread_id`. Catches the "accidental write to parent transpiler from worker" hazard.

---

## Section 18 — Comparison to PASS2

PASS2 audited the **call sites** that use these primitives. PASS3 audits the **primitives themselves** plus the cross-thread dispatch helpers and the type-system bypasses.

| PASS2 finding | PASS3 verdict |
| --- | --- |
| `pre-existing-ub-7` (FetchTasklet HTTP-thread Strong drop) | Confirmed. Mitigation `pass3-h-1` makes it CI-visible. |
| `pre-existing-ub-8` (atom-string discipline) | Confirmed. No new offending site found. |
| `pre-existing-ub-9` (FFI close → stale JIT trampoline) | Outside `bun_jsc`; unchanged. |
| `pre-existing-ub-10` (FFI closeCallback user-controlled ctx) | Outside `bun_jsc`; unchanged. Closely parallels `pass3-h-4` (`as_class_ref` `'static` over-approximation) and `JSValue::as_promise_ptr<T>` type-confusion (clean today, footgun-shaped). |
| `pre-existing-ub-11` (FFI raw-slice user-controlled length) | Outside `bun_jsc`; unchanged. |
| `pre-existing-ub-12` (FFI finalizer fn-ptr transmute) | Outside `bun_jsc`; unchanged. |

**New findings in PASS3:**
- `pass3-contract-1` (JsRef::Weak stale-cell contract)
- `pass3-contract-2` (ConcurrentPromiseTask / WorkTask blanket Send)
- `pass3-contract-3` (Blob `unsafe impl Sync` with `Cell` fields)
- `pass3-contract-4` (VirtualMachine `unsafe impl Sync` propagation)
- `pass3-h-1` through `pass3-h-5` (hardening obligations)
- `pass3-d-1`, `pass3-d-2`, `pass3-d-3` (doc-only)

---

## Section 19 — What this audit did NOT find

- **No `Strong::create` site that double-refs.** PASS2 sampled 22 sites; PASS3 spot-checked an additional 8 (in async_module, ResolveMessage, JSPromise.from_value, AsyncModule.rs:171, etc.) — all consistent with the single-transfer contract.
- **No `Weak<T>` site that drops the ctx before the JS cell.** Both current `WeakRefType` variants tie ctx lifetime to the JS cell lifetime.
- **No JSValue type-confusion bug.** Every `as_X` site checks `is_cell()` before downcast; every `as_X_unwrap()` is a panic-abort path under the Bun profiles using `panic=abort`.
- **No actual cross-thread Strong drop introduced by the Rust port** beyond the FetchTasklet site PASS2 already flagged. The Rust auto-trait inference catches everything the type system can see; the residual hazards are all `unsafe impl Send` bypasses or `*mut HostStruct` cast laundering.
- **No `IntrusiveRc` race condition.** `bun_ptr::RawRefCount` uses `AtomicU32` with appropriate ordering (`Acquire` on deref-to-zero, `Release` on ref bump). Verified at `ptr/lib.rs:RawRefCount` and `webcore_types.rs:Blob__deref`.
- **No `BackRef` stale-pointer dereference** in the five sites sampled. The owner-outlives-holder invariant is structurally true for every in-tree use.
- **No GC finalizer aliasing**: JSC mutator-thread-only sweep means finalizers run with the JS thread paused for that VM. Bun does not configure JSC for concurrent finalize.
- **No `mark_binding` discipline bug.** `mark_binding` is a debug-log no-op; missing calls are a logging gap, not a soundness issue.

---

## Section 20 — Severity and priority summary

| Priority | Finding | One-line fix |
| --- | --- | --- |
| P0 (CI gain) | `pass3-h-1` Strong destroy thread check | 5-line debug_assert |
| P0 (CI gain) | `pass3-h-2` JsCell debug thread-id | 20-line repr-conditional field |
| P1 (de-foot-gun) | `pass3-contract-2` remove blanket Send on tasks | mechanical |
| P1 (de-foot-gun) | `pass3-contract-1` replace JsRef::Weak with Weak<()> | 4 call sites |
| P1 (de-foot-gun) | `pass3-h-5` Weak<T> lifetime tie | API change with no behavior change |
| P2 (refactor) | `pass3-contract-3` Blob field-level Sync | larger; doc-only first |
| P2 (refactor) | `pass3-contract-4` JsThreadOnlyBackRef wrapper | call-site migration |
| P3 (doc/hardening) | `pass3-h-3` host_fn_finalize | doc + reference impl |
| P3 (doc/hardening) | `pass3-h-4` as_class_ref `'static` | generative lifetime |
| P3 (doc/hardening) | `pass3-d-1`/`-2`/`-3` | SAFETY-comment templates |

**No new live JSC UB path was proven in this pass** beyond the PASS2 findings already filed. The four former `pass3-ub-*` items are still production-worthy hardening work because they encode JS-thread and GC discipline in review conventions instead of types or runtime checks. The audit's purpose is to:
1. Make the discipline auditable via CI debug-asserts (`pass3-h-1`, `pass3-h-2`, `pass3-h-5` PR-1/2/5).
2. Move the discipline into the type system where Rust can enforce it (`pass3-contract-1`/`-2` PR-3/4).
3. Document the residual lies (`pass3-d-1`/`-2`/`-3`).

---

## Section 21 — Methodology notes

- **Counting.** `unsafe`-token density was computed with `grep -c -E '\bunsafe\b'` per file (zsh-safe form). Counts include `unsafe extern`, `unsafe fn`, `unsafe { }`, and `unsafe impl`. Total: ~745 in `src/jsc/`.
- **Sampling.** Six top-density files (`VirtualMachine.rs`, `event_loop.rs`, `ipc.rs`, `JSValue.rs`, `RuntimeTranspilerStore.rs`, `web_worker.rs`) were read end-to-end at the unsafe-relevant ranges. Mid-density files were sampled at every `unsafe impl` and the surrounding ±30 lines.
- **Cross-thread tracing.** Each task wrapper (`AnyTaskJob`, `WorkTask`, `ConcurrentPromiseTask`, `RuntimeTranspilerStore::TranspilerJob`, `CppTask`/`ConcurrentCppTask`, `Debugger::start_js_debugger_thread`, `WebWorker::thread_main`) was traced parent → schedule → worker callback → re-enqueue → JS-thread completion → Drop. The `Strong` / `Weak` / OwnedString fields were tracked at each phase.
- **PASS2 cross-reference.** Findings catalog cross-checked against PASS2's `pre-existing-ub-7`/`-8` so that overlapping observations are attributed to PASS2 and only the new analytic content is filed in PASS3.

---

## Appendix A — `unsafe impl Send/Sync` site inventory (13 in `src/jsc/`)

| Site | Type | Verdict |
| --- | --- | --- |
| `AbortSignal.rs:210` | `ExternalSharedDescriptor for AbortSignal` | clean (intrusive C++ refcount) |
| `array_buffer.rs:1074` | `ExternalSharedDescriptor for JSCArrayBuffer` | clean |
| `ConcurrentPromiseTask.rs:55` | `Send for ConcurrentPromiseTask<'_, C>` | **`pass3-contract-2`** |
| `hot_reloader.rs:421-422` | `Send + Sync for WatchChangedPaths` | clean (init-once) |
| `Debugger.rs:593` | `Send for SendVmPtr` | clean (thread-spawn shim) |
| `JSCell.rs:126-128` | `Sync + Send for JsCell<T>` | doc-only lie (`pass3-d-3`) |
| `WorkTask.rs:58` | `Send for WorkTask<C>` | **`pass3-contract-2`** |
| `webcore_types.rs:95-96` | `Send + Sync for Blob` | **`pass3-contract-3`** |
| `webcore_types.rs:489` | `ExternalSharedDescriptor for Blob` | clean |
| `webcore_types.rs:615-616` | `Send + Sync for Bytes` | clean |
| `webcore_types.rs:1200-1201` | `Send + Sync for StoreRef` | clean (atomic refcount) propagates JsCell lie |
| `web_worker.rs:590` | `Send for SendPtr` | clean (atomic fields) |
| `RuntimeTranspilerStore.rs:438` | `Linked for TranspilerJob` | clean (intrusive queue link) |
| `TopExceptionScope.rs:30-31` | `Send + Sync for SourceLocation` | clean (`&'static str` fields) |
| `VirtualMachine.rs:611-612` | `Send + Sync for VirtualMachine` | **`pass3-contract-4`** |
| `ipc.rs:307` | `NoUninit for IPCMessageType` | clean (bytemuck derive) |

(Counts 13 type-affinity impls + 4 trait-implementation impls; the latter are not Send/Sync but listed for completeness.)

---

## Appendix B — `unsafe extern "C" fn` count (FFI surface)

C++ symbols imported per file (rough count via `grep -c "safe fn\|unsafe extern \"C\""`):

- `VirtualMachine.rs`: ~20 (event loop control, JSC VM lifecycle)
- `JSValue.rs`: ~40 (encoded value primitives)
- `event_loop.rs`: ~5 (microtask drain)
- `JSPromise.rs`: 10
- `Strong.rs`: 4
- `Weak.rs`: 4
- `VM.rs`: 30 (API lock, GC, code clear, traps)
- `bindings/*.cpp`: source side — ~250 `extern "C"` symbols across StrongRef.cpp, bindings.cpp, BunDebugger.cpp, etc.

Total Bun-side FFI symbols imported in `bun_jsc`: ~400. Of those, ~120 are declared `safe fn` (opaque-ZST handle + scalar arguments only, validated by Type System); the remaining ~280 stay `unsafe fn` because they take raw `*mut`/`*const` payloads or callbacks.

The `safe fn` declaration is a structural unsafe-elimination win the port deliberately invested in (see `src/CLAUDE.md` "JSC interop & FFI safety" and the per-module SAFETY comments).

---

## Appendix C — Files reviewed

Reviewed end-to-end (full file):
- `Strong.rs`, `Weak.rs`, `JSRef.rs`, `JSCell.rs`, `JSPromise.rs`, `AnyPromise.rs`, `DeprecatedStrong.rs`, `ConcurrentPromiseTask.rs`, `WorkTask.rs`, `any_task_job.rs`, `CppTask.rs`, `VM.rs`

Reviewed key ranges (target sections):
- `VirtualMachine.rs` (lines 580-1250, 1900-2250)
- `event_loop.rs` (lines 1-700, 900-1100)
- `JSValue.rs` (lines 1-300, 900-1100)
- `RuntimeTranspilerStore.rs` (lines 400-820)
- `web_worker.rs` (lines 560-830)
- `Debugger.rs` (lines 580-790)
- `AbortSignal.rs` (lines 200-440)
- `host_fn.rs` (lines 1-300, 600-740)
- `ptr/lib.rs` (lines 100-680) — `BackRef`, `ThisPtr`, `LaunderedSelf`, Send/Sync
- `webcore_types.rs` (lines 80-260, 600-1210)
- `bun_string_jsc.rs` (lines 1-120)
- `virtual_machine_exports.rs` (full file)
- `array_buffer.rs` (lines 635-700, 1060-1100)

Spot-checked:
- `hot_reloader.rs` (WatchChangedPaths Send/Sync)
- `ipc.rs` (Windows pipe handlers)
- `ConsoleObject.rs` (from_js patterns)
- `bindings/StrongRef.cpp` (C++ side of Strong)

---

## Appendix D — Glossary

- **Atom string** — `WTF::AtomStringImpl`, an interned string in a per-thread table. Drop on a different thread trips `wasRemoved` in `AtomStringImpl::remove()`.
- **BackRef<T>** — Bun's non-owning, non-null back-reference. `Copy + Deref`. Soundness: pointee outlives holder (caller-asserted).
- **GC cell** — A `JSC::JSCell`-derived heap object, scanned/swept by JSC's `Heap`.
- **Handle slot** — A `JSC::JSValue*` allocated by `HandleSet::allocate()`. Kept live until `HandleSet::deallocate()`.
- **HandleSet** — Per-VM strong-root table. Thread-affinity: only the VM-owning thread may allocate/deallocate.
- **Intrusive refcount** — A refcount embedded in the type itself (e.g. `WebCore::RefCounted<T>`), distinct from `Arc<T>`. `WebCore::AbortSignal`, `Blob::Store` use this.
- **JsCell<T>** — `repr(transparent) UnsafeCell<T>` with `unsafe impl Sync` (the lie). Sound only on single-JS-thread.
- **JsRef** — Enum holding either a bare `JSValue` (weak; needs finalizer wiring) or a `Strong`. Used by native classes for back-reference to their JS wrapper.
- **mark_binding** — Debug-only logging fn (`bun_core::Global::JSC_SCOPE.log`); no thread-affinity enforcement.
- **Mutator thread** — In JSC parlance, the thread executing JavaScript. Per-VM; equals "the JS thread" in Bun.
- **opaque_ffi! / opaque_ref / opaque_mut** — Bun's pattern for ZST handles backed by `UnsafeCell`. `&T` is ABI-identical to non-null `*const T`; `opaque_ref(p)` is the centralised non-null deref proof.
- **Strong** — RAII GC root over a `HandleSet` slot. `!Send + !Sync` via `NonNull<Impl>`. Drop deallocates the slot.
- **TaskTag** — Tagged-pointer discriminator for the `EventLoop`'s concurrent task queue; identifies how to dispatch a `*mut ()` task body.
- **Weak<T>** — GC-cleared root with ctx-pointer finalizer dispatch. `!Send + !Sync` via `PhantomData<*mut T>`.
- **WTFString** / **WTFStringImpl** — WebKit's atomic-refcounted UTF-8/Latin-1/UTF-16 string. Drop is thread-safe (unlike `AtomStringImpl`).

End of PASS3.
