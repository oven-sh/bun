# Section K: jsc-core — Phase 1 Unsafe-Surface Inventory

Format (per row): `file:line | site_kind | bucket(s) | safety_status | macro_status | prior_audit_id | notes`

Buckets (from UB-TAXONOMY.md): 1 aliasing, 2 provenance, 3 alignment, 4 validity,
5 uninit, 6 transmute, 7 races, 8 Send/Sync, 9 Pin, 10 FFI, 11 panic-safety,
12 std-trait invariants, 13 refcount lifecycle, 14 *const→write, 15 lifetime/escape,
16 volatile, 17 async-drop, 20 dangling Box/allocator, 21 FFI callback aliasing,
22 repr(packed) field addr, 23 observed type changes.

Crates: `bun_jsc` (`src/jsc/`, ~972 unsafe lexemes) + `bun_jsc_macros` (`src/jsc_macros/`, 21 emit-side lexemes).
Per-file counts and dominant kinds enumerated in `phase1_notes/K_jsc.md`. This file
lists the **highest-signal** sites (handle discipline, Send/Sync, JSC-task wrappers,
host-fn macro expansion contracts, refcount lifecycle, anchored hazards). Routine
`opaque_ref()` ZST-handle helpers (~200 sites) and bindgen `unsafe extern "C"`
blocks (~150 sites with paired `safe fn` shims) are tallied by file group below.

---

## A. Strong/Weak handle discipline (CONCURRENCY-CRITICAL)

Strong/Weak are `!Send + !Sync` by virtue of `NonNull<Impl>` (Strong) or
`NonNull<WeakImpl>` + `GlobalRef` (Weak). Both contracts: **created and dropped on the JS thread**.

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/jsc/Strong.rs:11-15` | struct + auto-derived `!Send/!Sync` | 8 | PRESENT_STRONG (lines 12-14, doc) | SOURCE_DIRECT | n/a | `NonNull<Impl>` is `!Send/!Sync`; comment explicitly cites HandleSet drop-thread invariant |
| `src/jsc/Strong.rs:51` | `unsafe fn adopt(handle)` | 13+10 | PRESENT_STRONG (:48-50) | SOURCE_DIRECT | S-* | Caller proves handle came from `Bun__StrongRef__new` and is uniquely owned |
| `src/jsc/Strong.rs:59-60` | `unsafe { Impl::destroy }` (Drop) | 13 | PRESENT_STRONG (:59) | SOURCE_DIRECT | S-* | Drop releases HandleSet slot; consumed exactly once |
| `src/jsc/Strong.rs:71-74` | `Optional` `#[repr(transparent)]` over `Option<NonNull>` | 8+10 | PRESENT_STRONG (:69-70) | SOURCE_DIRECT | n/a | FFI-safe nullable encoding documented |
| `src/jsc/Strong.rs:93` | `unsafe fn adopt(Option<NonNull>)` | 13+10 | PRESENT_STRONG (:90-92) | SOURCE_DIRECT | S-* | Optional adopt path; same contract as :51 |
| `src/jsc/Strong.rs:174` | `unsafe { Impl::destroy }` (deinit) | 13 | PRESENT_STRONG (:173) | SOURCE_DIRECT | S-* | Explicit teardown for Zig-port `strong.deinit()` |
| `src/jsc/Strong.rs:194` | `unsafe { Impl::destroy }` (Optional Drop) | 13 | PRESENT_STRONG (:193) | SOURCE_DIRECT | S-* | Mirror of :60 for Optional |
| `src/jsc/Strong.rs:215` | `unsafe { *this.as_ptr().cast::<JSValue>() }` | 4+6+10 | PRESENT_STRONG (:209-214) | SOURCE_DIRECT | S-* | Reads JSC HandleSlot as `JSValue`; comment cites repr(transparent) usize |
| `src/jsc/Strong.rs:229-249` | `unsafe fn destroy` + corruption probe | 13+11 | PRESENT_STRONG (:228, :231-247) | SOURCE_DIRECT | S-* | 0x10000 floor guards Windows null-page (#53265 fs-promises segfault); panic surfaces caller frame |
| `src/jsc/Strong.rs:259-264` | `unsafe extern "C"` block (4 fns, 3 `safe fn`) | 10 | PRESENT_STRONG (:253-258) | SOURCE_DIRECT | n/a | `delete` stays `unsafe fn` (consumes alloc); other 3 use opaque-handle reasoning |
| `src/jsc/Weak.rs:55-58` | `unsafe fn destroy` (WeakImpl) | 13 | PRESENT_STRONG (:56) | SOURCE_DIRECT | S-* | Mirror of Strong |
| `src/jsc/Weak.rs:69-79` | `unsafe extern "C"` block (4 fns, 3 `safe fn`) | 10+15 | PRESENT_STRONG (:61-68, but see note) | SOURCE_DIRECT | n/a | `Bun__WeakRef__new` is `safe fn` for the allocation/handle creation itself, but `ctx` is later forwarded to the C++ weak-owner finalizer (`src/jsc/bindings/Weak.cpp:32-44`) and then to Rust (e.g. `Bun__FetchResponse_finalize`). Treat the `ctx` lifetime/thread contract as an explicit Phase-2 obligation, not an inert round-trip pointer. |
| `src/jsc/Weak.rs:81-95` | `Weak<T>` struct (`!Send/!Sync` via `NonNull<WeakImpl>` + `PhantomData<*mut T>`) | 8 | PRESENT_WEAK (no explicit doc on type — relies on auto-trait) | SOURCE_DIRECT | n/a | **No explicit Send/Sync doc on type itself**, only on `WeakImpl::get` |
| `src/jsc/Weak.rs:186-195` | `Drop for Weak<T>` + `unsafe { destroy }` | 13 | PRESENT_STRONG (:192) | SOURCE_DIRECT | S-* | RAII cleanup |
| `src/jsc/JSPromise.rs:88-90` | `pub struct Weak<T>` wrapping `JscWeak<T>` | 8 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Inherits `!Send/!Sync` from `JscWeak` |
| `src/jsc/JSPromise.rs:147-149` | `pub fn get(&self) -> &mut JSPromise` (safe!) | 1+8 | PRESENT_STRONG (:142-146) | SOURCE_DIRECT | n/a | **Hands out `&mut` from `&self`**; sound only via `opaque_ffi!` ZST → zero-byte coverage |
| `src/jsc/JSPromise.rs:181-184` | `pub struct Strong { strong: JscStrong }` | 8 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Inherits `!Send/!Sync` from `JscStrong` |
| `src/jsc/DeprecatedStrong.rs:56-62` | `pub struct DeprecatedStrong` (bare JSValue + canary) | 13+11 | PRESENT_STRONG (:7-17, :56-62) | SOURCE_DIRECT | S-* | TODO(port) at :15-17 flags **release-build double-unprotect risk** when caller balances `unref` then lets Drop fire |
| `src/jsc/DeprecatedStrong.rs:77-83` | `bun_core::heap::into_raw_nn` canary | 13 | PRESENT_STRONG (block comment) | SOURCE_DIRECT | n/a | Debug-only ManuallyDrop heap canary |
| `src/jsc/DeprecatedStrong.rs:120-128` | `unsafe { drop(heap::take(...)) }` (unref final) | 13+11 | PRESENT_STRONG (:120) | SOURCE_DIRECT | S-* | Frees canary without running Drop on sentinel |
| `src/jsc/DeprecatedStrong.rs:144-154` | `unsafe { drop(heap::take(...)) }` (Drop) | 13+11 | PRESENT_STRONG (:144-145) | SOURCE_DIRECT | S-* | Mirror of :120 path |
| `src/jsc/DeprecatedStrong.rs` | (whole file) `Send`/`Sync` status | 8 | **NOT EXPLICITLY DOCUMENTED on type** | SOURCE_DIRECT | n/a | Relies on `JSValue: !Send/!Sync` propagating; would benefit from explicit `PhantomData<*const ()>` or doc |
| `src/jsc/JSRef.rs:99-113` | `JsRef` `!Send + !Sync` belt-and-suspenders | 8 | PRESENT_STRONG (:99-110) | SOURCE_DIRECT | n/a | Explicit `const _: PhantomData<*const ()>` pattern; TODO(port) suggests wrap-in-struct |

## B. JSC task wrappers (the "tracked separately" hazards)

Per the prior audit's executive summary, these are the JSC-adjacent unsafe-contract hazards.

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/jsc/any_task_job.rs:52-58` | `pub struct AnyTaskJob<C>` | 8+13+21 | PRESENT_STRONG (file header, type doc) | SOURCE_DIRECT | n/a | Generic over `C: AnyTaskJobCtx`; **no explicit Send impl** — relies on field auto-traits + the work-pool invariant |
| `src/jsc/any_task_job.rs:60` | `bun_threading::intrusive_work_task!([C] AnyTaskJob<C>, task)` | 8+13 | MACRO_GENERATED | MACRO_GENERATED | n/a | Macro emits the `IntrusiveWorkTask` impl; Send obligation flows through the macro |
| `src/jsc/any_task_job.rs:62-69` | `Drop for AnyTaskJob<C>` + `poll.unref` | 11+17 | PRESENT_STRONG (:65-68) | SOURCE_DIRECT | n/a | No-op safe on init-failure path; ctx drops via field glue |
| `src/jsc/any_task_job.rs:90-99` | `unsafe { (*job).any_task = AnyTask {..} }` | 1+5+13 | PRESENT_STRONG (:90-93) | SOURCE_DIRECT | S-003241 | Builds erased AnyTask with non-capturing shim; default `AnyTask` placed first to avoid UB via `zeroed()` |
| `src/jsc/any_task_job.rs:104` | `unsafe { bun_core::heap::take(job) }` (scopeguard) | 13 | PRESENT_STRONG (:103) | SOURCE_DIRECT | S-003242 | init-failure reclaim |
| `src/jsc/any_task_job.rs:107` | `unsafe { (**guard).ctx.init(global)? }` | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-003243 | Through-double-deref of guard wrapper |
| `src/jsc/any_task_job.rs:118-123` | `pub unsafe fn schedule(this: *mut Self)` | 13+21 | PRESENT_STRONG (:115-117) | SOURCE_DIRECT | S-003244 | Caller proves live, freshly-created, not yet scheduled |
| `src/jsc/any_task_job.rs:141-153` | `fn run_task(task: *mut WorkPoolTask)` | 1+13+21 | PRESENT_STRONG (:140-144) | SOURCE_DIRECT | S-003247 | Off-thread; recovers parent via `from_task_ptr` |
| `src/jsc/any_task_job.rs:158-167` | `fn run_from_js(this: *mut Self)` | 13 | PRESENT_STRONG (:159-160) | SOURCE_DIRECT | S-003248 | JS-thread reclaim via `heap::take`; AnyTask fires exactly once |
| `src/jsc/CppTask.rs:22-23` | `Taskable for CppTask` | 8 | n/a (trait impl) | SOURCE_DIRECT | n/a | Tag = `task_tag::CppTask` |
| `src/jsc/CppTask.rs:39` | `unsafe { crate::cpp::Bun__performTask(global, ...) }` | 10+11 | PRESENT_STRONG (:30-38) | SOURCE_DIRECT | n/a | Routes through `cpp::` wrapper that opens TopExceptionScope; raw FFI tripped `BUN_JSC_validateExceptionChecks=1` |
| `src/jsc/CppTask.rs:48-50` | `unsafe { Bun__EventLoopTaskNoContext__performTask(this) }` | 10+13 | PRESENT_STRONG (:48) | SOURCE_DIRECT | n/a | Performs task, frees C++ alloc |
| `src/jsc/CppTask.rs:63-67` | `#[repr(C)] pub struct ConcurrentCppTask { cpp_task: *mut, workpool_task }` | 8+10+13 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Crosses threads; no explicit Send doc, relies on `owned_task!` macro |
| `src/jsc/CppTask.rs:69` | `bun_threading::owned_task!(...)` | 8+13 | MACRO_GENERATED | MACRO_GENERATED | n/a | |
| `src/jsc/CppTask.rs:72-85` | `fn run_owned(self: Box<Self>)` | 13+21 | PRESENT_STRONG | SOURCE_DIRECT | n/a | Drains then runs; concurrent unref |
| `src/jsc/CppTask.rs:87-99` | `#[unsafe(no_mangle)] pub extern "C" fn ConcurrentCppTask__createAndRun` | 10+21 | PRESENT_STRONG (:90-91) | SOURCE_DIRECT | n/a | C++→Rust callback entry; ref_concurrently then schedule |
| `src/jsc/ConcurrentPromiseTask.rs:51-55` | `unsafe impl<C> Send for ConcurrentPromiseTask<'_, C>` | 8 | SUPERSEDED_BY_EXP-046 | SOURCE_DIRECT | S-* | Phase-1 mapper initially accepted the sequencing comment. Phase-5 `+ Send` bound experiment and owned-wrapper Miri witness proved the trait boundary is unsafe-contract debt: `ConcurrentPromiseTaskContext` lacks `Send`, `ctx: Box<C>` is owned by the task, and real in-tree contexts fail the bound. |
| `src/jsc/WorkTask.rs:54-58` | `unsafe impl<C> Send for WorkTask<C>` | 8 | SUPERSEDED_BY_EXP-046 | SOURCE_DIRECT | S-* | Same missing-bound family. Nuance: production `WorkTask` stores `ctx: *mut C`, so per-context exploitability is narrower than the owned-wrapper witness, but the Phase-1 "raw ptrs are inert" conclusion is no longer a defensible final verdict. |
| `src/jsc/RuntimeTranspilerStore.rs:437-444` | `unsafe impl unbounded_queue::Linked for TranspilerJob` + `unsafe fn link` | 8+1 | PRESENT_STRONG (:437, :441) | SOURCE_DIRECT | S-* | Intrusive queue link for TranspilerJob |
| `src/jsc/event_loop.rs:923-940` | `pub fn enqueue_task_concurrent(&self, *mut ConcurrentTaskItem)` | 7+8+13 | PRESENT_WEAK (panics on terminated VM) | SOURCE_DIRECT | n/a | Cross-thread enqueue point |
| `src/jsc/event_loop.rs:1088-1108` | `pub fn enqueue_task_concurrent_batch` | 7+8+13 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Batch path |
| `src/jsc/event_loop.rs:225` | `unsafe extern "C" { ... }` (5 sites in file) | 10 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Loop-tick entry; many `unsafe { (*this).field }` derefs |

## C. unsafe impl Send/Sync inventory (FULL)

23 actual `unsafe impl` lines across both crates (`rg '^\\s*unsafe\\s+impl'`);
the earlier 29-count included comment references to "unsafe impl". The
non-Send/Sync ones (5) are
auxiliary trait impls (`ExternalSharedDescriptor` x3, `bytemuck::NoUninit` x1,
`unbounded_queue::Linked` x1) — separate hazard class.

| file:line | type | safety | notes |
| --- | --- | --- | --- |
| `src/jsc/JSCell.rs:126,128` | `JsCell<T>` Sync+Send | SUPERSEDED_BY_EXP-045 | Phase-1 accepted the single-JS-thread invariant. EXP-045 later confirmed the generic unbounded auto-trait contract is unsound for `JsCell<Cell<_>>`; production JS-affine reachability remains separate. |
| `src/jsc/VirtualMachine.rs:611,612` | `VirtualMachine` Sync+Send | SUPERSEDED_BY_EXP-084 | Phase-1 accepted the singleton invariant. EXP-084 later confirmed the safe `&VirtualMachine` cross-thread + TLS `unwrap_unchecked` trap; no proven production worker capture is claimed. |
| `src/jsc/ConcurrentPromiseTask.rs:55` | `ConcurrentPromiseTask<'_, C>` Send | SUPERSEDED_BY_EXP-046 | Missing `C: Send` bound; Phase-5 compile experiment shows all real `ConcurrentPromiseTaskContext` impls fail the bound. `ctx: Box<C>` makes this the stronger half of EXP-046. |
| `src/jsc/WorkTask.rs:58` | `WorkTask<C>` Send | SUPERSEDED_BY_EXP-046 | Missing `C: Send` bound; production wrapper stores `*mut C`, so EXP-046 keeps production exploitability per-context, but the generic trait boundary is not a discharged invariant. |
| `src/jsc/web_worker.rs:590` | `SendPtr` Send (local newtype) | PRESENT_STRONG (:587-589, :596-597) | Worker-thread-only fields; cross-thread via atomics/locks |
| `src/jsc/Debugger.rs:593` | `SendVmPtr` Send (local newtype) | PRESENT_STRONG (:585-589, :591-592) | Mediated by holdAPILock / futex; VM is `'static` |
| `src/jsc/TopExceptionScope.rs:30,31` | `SourceLocation` Send+Sync | PRESENT_STRONG (:26-29) | Pointers always `'static` (literals or leaked CStrings) |
| `src/jsc/webcore_types.rs:95,96` | `Blob` Send+Sync | SUPERSEDED_BY_EXP-082 | Phase-1 accepted the ObjectURLRegistry / work-pool discipline. EXP-082 later confirmed the generic safe-API defect: a `Send + Sync` Blob exposes safe `global_this(&self) -> Option<&JSGlobalObject>` and therefore a JS-thread-affine handle whenever the pointer is present. |
| `src/jsc/webcore_types.rs:615,616` | `Bytes` Send+Sync | PRESENT_STRONG (:612-614) | Morally `Vec<u8>`; uniquely owned `NonNull<u8>` |
| `src/jsc/webcore_types.rs:1200,1201` | `StoreRef` Send+Sync | PRESENT_STRONG (:1197-1199) | Atomic refcount; immutable-after-init payload |
| `src/jsc/hot_reloader.rs:421,422` | `WatchChangedPaths` Send+Sync | PRESENT_STRONG (:418-420, type docs) | Init-once-then-read-only after watcher thread starts |
| `src/jsc/AbortSignal.rs:210` | `bun_ptr::ExternalSharedDescriptor for AbortSignal` | PRESENT_STRONG (:212, :217) | C++ refcount FFI bridge; `opaque_ref` is the centralised non-null proof |
| `src/jsc/array_buffer.rs:1074` | `ExternalSharedDescriptor for JSCArrayBuffer` | PRESENT_STRONG (:1076-1078) | Same pattern |
| `src/jsc/webcore_types.rs:489` | `ExternalSharedDescriptor for Blob` | PRESENT_STRONG (:487-488 + method comments :491/:495) | Blob ref/deref bridge; Phase 3 should still verify the intrusive refcount lifecycle, but this is not a missing-SAFETY-comment site. |
| `src/jsc/RuntimeTranspilerStore.rs:438` | `unbounded_queue::Linked for TranspilerJob` | PRESENT_STRONG (:437, :441) | Intrusive node accessor |
| `src/jsc/ipc.rs:307` | `bytemuck::NoUninit for IPCMessageType` | PRESENT_STRONG (:305-307) | `#[repr(u8)]` fieldless enum; no padding |

## D. JSValue ↔ ptr conversions (cross-thread hazards)

JSValue is `!Send + !Sync` via `PhantomData<*const ()>`. JsRef adds belt-and-suspenders.

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/jsc/JSValue.rs:30-32` | `#[repr(transparent)] struct JSValue(usize, PhantomData<*const ()>)` | 8+10 | PRESENT_STRONG (:1-9, :21-29) | SOURCE_DIRECT | n/a | Documented `!Send + !Sync`; ABI-compat with EncodedJSValue |
| `src/jsc/JSValue.rs:65-66, :79-80, :86-89, :95-99` | `from_encoded`/`from_raw`/`from_cell`/`from_ptr_address` (all `safe fn`) | 4+10 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Encode opaque bit-patterns; `from_cell<T>(cell: *const T)` casts pointer to usize |
| `src/jsc/JSGlobalObject.rs:43-45` | `#[repr(transparent)] GlobalRef(BackRef<JSGlobalObject>)` | 8 | PRESENT_STRONG (:30-42) | SOURCE_DIRECT | n/a | `Copy`; `!Send + !Sync` via `BackRef`; centralises the unsafe-deref into one site |
| `src/jsc/JSGlobalObject.rs:60-69` | `Deref for GlobalRef` | 1+15 | PRESENT_STRONG (:64-67) | SOURCE_DIRECT | n/a | Single audited deref replacing ~90 lifetime erasures to `'static` |
| `src/jsc/AbortSignal.rs:16-26` | `opaque_ffi! { struct AbortSignal }` (real `UnsafeCell`) | 1+8+10 | PRESENT_STRONG (:19-25) | MACRO_GENERATED | n/a | **Doc explicitly cites why a real `UnsafeCell` (not `PhantomData<UnsafeCell<_>>`) is required** |

## E. Refcount lifecycle (`Box::from_raw`, `heap::take`, `Arc::from_raw`)

`bun_core::heap::take` is the local equivalent of `Box::from_raw`. ~30 sites in jsc/.

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/jsc/AbortSignal.rs:404-409` | `unsafe fn deinit` + `heap::take` | 13+20 | PRESENT_STRONG (:404-405) | SOURCE_DIRECT | S-003237 | Pairs `heap::alloc` in `init` |
| `src/jsc/AbortSignal.rs:438` | `unsafe { Timeout::deinit(this, ...) }` | 13 | PRESENT_WEAK | SOURCE_DIRECT | S-003240 | EventLoopTimer dispatch path |
| `src/jsc/RefString.rs:99-113` | `Box<[u8]>::from_raw` via `heap::take(slice_from_raw_parts_mut)` | 13+20 | PRESENT_STRONG (:99-110) | SOURCE_DIRECT | n/a | Manually constructs slice ptr from (ptr, len) for box reclaim |
| `src/jsc/ResolvedSource.rs:113-117` | `core::mem::forget(self)` after into_ffi | 11+13 | PRESENT_STRONG (:108-112) | SOURCE_DIRECT | n/a | Transfers `BunString::deref()` obligation to C++ `Zig::ResolvedSource` consumers |
| `src/jsc/event_loop.rs:579, :596, :1323` | `unsafe { bun_core::heap::take(dest) }` cluster | 13 | PRESENT_WEAK | SOURCE_DIRECT | n/a | Drop-after-tick + EventLoop teardown |
| `src/jsc/array_buffer.rs:399` | `unsafe { bun_core::heap::take(bytes as *mut [u8]) }` | 13+20 | PRESENT_WEAK | SOURCE_DIRECT | S-003261 | Slice-via-cast; verify in Phase 2 if `bytes` provenance is safe (Box vs raw alloc) |

## F. Macro-generated unsafe (`bun_jsc_macros`)

The 21 `unsafe` lexemes in `src/jsc_macros/lib.rs` are **emit-side** (each generates many call-site shims).

| file:line | kind | bucket | safety | macro | prior_id | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/jsc_macros/lib.rs:81-102` | `jsc_extern_fn` emitter (sysv64/C dual-shim) | 10 | PRESENT_STRONG (:73-80) | EMITS | n/a | Two `pub unsafe extern` shims with `#[cfg]` split |
| `src/jsc_macros/lib.rs:113-252` | `expand_host_fn` (R-2 receiver discipline) | 1+10+21 | PRESENT_STRONG (:127-138, :168, :200-203) | EMITS | n/a | **R-2 anchor**: shared receivers get `&*__this`, mut get `&mut *__this`; SAFETY narrative on every emitted shim |
| `src/jsc_macros/lib.rs:140` | emits `let __t = unsafe { &*__this };` | 1+21 | EMITTED-WITH-SAFETY (:200-203 in template) | EMITS | n/a | Per-call-site shim has the `// SAFETY:` comment |
| `src/jsc_macros/lib.rs:142` | emits `let __t = unsafe { &mut *__this };` | 1+21 | EMITTED-WITH-SAFETY | EMITS | n/a | Same as above; mut variant |
| `src/jsc_macros/lib.rs:323-344` | `codegen_cached_accessors!` extern blocks | 10 | PRESENT_STRONG (:319-322 narrative) | EMITS | n/a | `safe fn` + `#[link_name]` matched against generate-classes.ts output (clashing_extern_declarations check) |
| `src/jsc_macros/lib.rs:447-473` | `host_call` (bare ABI rewrite) | 10 | PRESENT_STRONG (:442-446, :459-463) | EMITS | n/a | Cargo of `#[unsafe(export_name = ...)]` left to caller |
| `src/jsc_macros/lib.rs:540-741` | `JsClass` proc-macro | 10+13 | PRESENT_STRONG (:476-489, :595-605, :617-622, :686-700) | EMITS | n/a | Emits `__from_js`/`__create`/`__getConstructor` extern stubs; `to_js_ptr` carries explicit `# Safety` clause |
| `src/jsc_macros/lib.rs:694` | emits `pub unsafe fn to_js_ptr(ptr: *mut Self, ...)` | 13+20 | EMITTED-WITH-SAFETY (:687-693) | EMITS | n/a | Caller proves heap-allocated and finalize-compatible |
| `src/jsc_macros/lib.rs:815-960` | `uws_callback` macro | 1+5+10+21 | PRESENT_STRONG (:744-776, :876-906, :929-940) | EMITS | n/a | **Slice (null,0) reconstruction** — uses dangling pointer for `&mut` empty slice (sound), `&[]` literal for `&` empty slice |
| `src/jsc_macros/lib.rs:886-906` | emits `slice::from_raw_parts{,_mut}` for slice args | 5+15 | EMITTED-WITH-SAFETY (:884-885, :902) | EMITS | n/a | `&mut [T]` thunk arg WARNING: macro cannot detect aliasing with `*self` — caller obligation |
| `src/jsc_macros/lib.rs:938` | emits `let __this = unsafe { #recv_expr };` | 1+21 | EMITTED-WITH-SAFETY (:935-937) | EMITS | n/a | __ctx is the *Self registered with C side; lives + exclusive for callback |
| `src/jsc_macros/lib.rs:951` | emits `pub unsafe extern "C" fn #thunk_ident` | 10 | EMITTED-WITH-SAFETY | EMITS | n/a | Uses `#[allow(improper_ctypes_definitions, clippy::not_unsafe_ptr_arg_deref)]` |

## G. Bindgen `unsafe extern "C"` blocks (mostly safe-fn-shim wrapped)

Per-file count of `unsafe extern "C"` blocks (155 total in src/jsc); each block usually contains
multiple `safe fn` declarations (the `opaque_ffi!` ZST handle pattern allows this).

| file (high-FFI) | unsafe extern blocks | dominant pattern |
| --- | --- | --- |
| `src/jsc/VirtualMachine.rs` | 1 | Many `safe fn` bindings; `&JsVm` opaque-handle reasoning |
| `src/jsc/host_fn.rs` | several | Macro support glue |
| `src/jsc/event_loop.rs` | 2+ | EventLoop tick + Async hooks; mixes `unsafe` and `safe` |
| `src/jsc/ConsoleObject.rs` | several | Logging FFI surface; massive `headers-handwritten.h` consumer |
| `src/jsc/ZigString.rs` | several | `ZStr::from_raw` per call; FFI-safe `repr(C)` exchange |
| `src/jsc/CallFrame.rs` | several | `slice::from_raw_parts` for argv; `ZStr::from_raw` |

(Routine. Not enumerated row-by-row — verified the **`safe fn` discipline**:
opaque ZST handles permit `safe fn` even across FFI; out-params, `*mut c_void`
ctxs, and consume-allocation calls remain `unsafe fn`.)

## H. Anchored finds (carried from prior audit)

The prior audit's executive summary called out two JSC-adjacent areas:
1. "JSC task / weak-reference wrapper findings remain tracked separately as unsafe-contract hazards" — covered by Sections A, B above.
2. "`bun_jsc::Strong/Weak` thread-affinity-aware and audited as `!Send + !Sync`" — confirmed in Section A; **`Weak<T>` in `Weak.rs:81-95` lacks an explicit type-level Send/Sync doc** (relies on auto-trait inference) and `DeprecatedStrong` lacks both an explicit doc AND a `PhantomData<*const ()>` marker.

## I. PhantomPinned pattern (consistent)

`PhantomData<core::cell::UnsafeCell<()>>` + `PhantomPinned` appear together to achieve `!Freeze` + `!Unpin` for opaque FFI handles. The `opaque_ffi!` macro embeds these.
