# Section K: jsc-core

## Purpose

`bun_jsc` (`src/jsc/`, ~75 source files) is the JSC FFI surface and Rust-side
runtime glue: JSC value types (`JSValue`, `JSCell`, `JSGlobalObject`,
`JSPromise`, `JSObject`, `JSString`, `ArrayBuffer`, `JSC::Weak`/`Strong`),
the per-thread `VirtualMachine` singleton, the event loop (`event_loop.rs`,
`AbortSignal.rs`, `Debugger.rs`, `hot_reloader.rs`), task wrappers
(`AnyTaskJob`, `WorkTask`, `ConcurrentPromiseTask`, `CppTask`,
`RuntimeTranspilerStore`), web worker / IPC, and the `bun_string_jsc` /
`fmt_jsc` / `comptime_string_map_jsc` JSC-side bridges. `bun_jsc_macros`
provides the `#[host_fn]`, `#[host_call]`, `#[JsClass]`,
`#[uws_callback]`, and `codegen_cached_accessors!` proc-macros.

This section is a **concurrency hub**: every JSC handle is single-JS-thread by
design, and every cross-thread artifact (workpool tasks, event-loop wakers,
WebWorker spawn, debugger thread) crosses a documented `unsafe impl Send` /
`SendPtr`-newtype boundary.

## Unsafe-surface tally (vs prior 745)

Raw lexeme counts from `rg '(^|[^a-zA-Z])unsafe(\s+(fn|impl|trait|extern|\{))'`:

| Crate | sites | prior | delta | notes |
| --- | --- | --- | --- | --- |
| `bun_jsc` | 972 | 745 | +227 | Growth driven by **macro template expansion** of `host_fn` / `uws_callback` shims and the recent `hot_reloader.rs` rewrite (45 KB → 68 KB) |
| `bun_jsc_macros` | 21 | (not counted in prior — proc-macro crate) | — | Each `unsafe` lexeme here is an emit-site that produces N call-site shims |
| **Total** | **993** | **745** | **+248** | |

Top files by lexeme count (bun_jsc only):
- `VirtualMachine.rs` 153 — singleton accessors, JsCell, holdAPILock surface
- `ipc.rs` 50 — IPC parser (NoUninit impl, header bit-twiddling)
- `event_loop.rs` 44 — tick loop, ConcurrentTask, EventLoop FFI
- `RuntimeTranspilerStore.rs` 43 — TranspilerJob (intrusive queue, OwnedResolvedSource)
- `JSValue.rs` 42 — `from_*` ctor cluster + tag-pun helpers
- `web_worker.rs` 35 — `SendPtr` thread spawn, atomic state machine
- `webcore_types.rs` 32 — Blob / Bytes / StoreRef Send+Sync
- `ConsoleObject.rs` 32 — vast logging FFI surface (244 KB file)
- `generated.rs` 26 — auto-generated; treat as macro-derived
- `btjs.rs` 25 — backtrace formatting
- `array_buffer.rs` 25 — ArrayBuffer/TypedArray surface

SAFETY comment density: 750 `// SAFETY:` lines in `bun_jsc` (≈77% of unsafe sites
have a comment within 5 lines) — this is high. `bun_jsc_macros`: 8 SAFETY lines,
all on emit-side templates that propagate to N generated shims.

## Strong/Weak handle discipline audit

**Status: largely strong; one explicit-doc gap.**

| Type | `!Send` | `!Sync` | Mechanism | Explicit doc | Runtime guard? |
| --- | --- | --- | --- | --- | --- |
| `bun_jsc::Strong` | YES | YES | `NonNull<Impl>` auto-trait | YES (Strong.rs:13-14) | Pointer-corruption floor only (`Strong.rs:243-247`); not a thread-affinity assertion |
| `bun_jsc::strong::Optional` | YES | YES | `Option<NonNull<Impl>>` | YES (transparent doc) | Drop impl symmetric |
| `bun_jsc::Weak<T>` | YES | YES | `NonNull<WeakImpl>` + `PhantomData<*mut T>` | **NO** (no type-level doc; relies on auto-trait) | Drop impl symmetric, but no thread-affinity assertion |
| `bun_jsc::JSPromise::Weak<T>` | YES | YES | wraps `JscWeak<T>` | NO type-level doc | Inherits |
| `bun_jsc::JSPromise::Strong` | YES | YES | wraps `JscStrong` | NO type-level doc | Inherits |
| `bun_jsc::DeprecatedStrong` | YES | YES | bare JSValue field (`!Send` via JSValue) | **NO** (and no `PhantomData<*const ()>` marker) | Debug canary only |
| `bun_jsc::JsRef` | YES | YES | belt-and-suspenders `const _: PhantomData<*const ()>` | YES (JSRef.rs:99-110) | TODO at :111-113 suggests struct-wrap upgrade |
| `bun_jsc::GlobalRef` | YES | YES | `BackRef<JSGlobalObject>` | YES (JSGlobalObject.rs:30-42) | Single audited deref via `Deref` |

Documented enforcement: `Strong::Impl::destroy` includes a debug+windows
assertion that `this.as_ptr() >= 0x10000` (Windows null-page floor) to surface
a corrupting writer (#53265 fs-promises segfault). This is a **defensive crash
for diagnosis**, not a thread-affinity check.

## JSC task wrapper enumeration (the "tracked separately" hazards)

Six task-shaped types cross thread boundaries with documented `unsafe impl Send`
or via heap-pointer round-trip through the work pool. Per the prior audit
exec-summary call-out, these warrant Phase 2 attention:

1. **`AnyTaskJob<C>`** (`src/jsc/any_task_job.rs`, ~170 LOC) — the canonical
   "WorkPool offload → AnyTask re-queue → JS-thread completion" boilerplate
   that replaced 5 hand-rolled Zig sites (SecretsJob, ExternCryptoJob,
   CryptoJob<Ctx>, PBKDF2::Job, ZstdJob). Heap-allocated; `*mut Self` crosses
   threads; SAFETY comments on every transition. **Macro-generated trait impl
   via `intrusive_work_task!`**.

2. **`ConcurrentPromiseTask<'a, Context>`** — `unsafe impl Send` at line 55,
   intrusive `task` node, BackRef to event loop. **Phase-5 correction:** this
   is not a clean "address-only crossing" discharge. EXP-046 proves the missing
   `Context: Send` bound is a real unsafe-contract defect; the wrapper owns
   `ctx: Box<Context>`.

3. **`WorkTask<Context>`** — `unsafe impl Send` at line 58, mirror shape.
   **Phase-5 correction:** same missing-bound family, but with narrower
   production evidence because `WorkTask` stores `ctx: *mut Context`. Treat as
   EXP-046 unsafe-contract debt, not as a fully discharged Phase-1 invariant.

4. **`CppTask`** + **`ConcurrentCppTask`** — C++-originated tasks. The
   `Bun__performTask` call MUST go through `cpp::` wrapper (which opens
   TopExceptionScope) instead of raw FFI, or `BUN_JSC_validateExceptionChecks=1`
   trips inside `drainMicrotasks`. The codebase has fixed this; the SAFETY
   comment in `CppTask.rs:30-38` documents the failure mode.

5. **`RuntimeTranspilerStore::TranspilerJob`** — `unsafe impl
   unbounded_queue::Linked` at line 438. `OwnedResolvedSource` carries the
   refcount-transfer obligation across threads via `into_ffi() →
   mem::forget(self)` (ResolvedSource.rs:113-117).

6. **`AnyTaskJobCtx` impls** (CryptoJob, etc.) — distributed across `runtime/`,
   not Section K. Each carries a `Drop` that may run on either the JS thread
   (success) or the work-pool thread (init failure) — verify in Phase 2.

**Open hazard (Phase 2 candidate):** `Weak<T>::create` calls `WeakImpl::init`
which forwards `ctx: &mut T` as `*mut c_void` to C++. That pointer is not merely
"stored and never dereferenced": `src/jsc/bindings/Weak.cpp:32-44` forwards it
to the selected weak-owner finalizer, and the live `FetchResponse` path reaches
`Bun__FetchResponse_finalize` / `FetchTasklet::on_response_finalize`. The
Rust-side `Weak<T>` type is `!Send + !Sync`, so ordinary movement to a non-JS
thread should be statically blocked, but Phase 2 must verify the finalizer runs
on the expected mutator/JS thread and that the `ctx` outlives the weak handle.

## unsafe impl Send/Sync inventory

23 actual `unsafe impl` lines total (`rg '^\\s*unsafe\\s+impl'`; the looser
lexeme scan counted 6 comment references). By bucket:

- **Send/Sync (18)**: distributed across 11 types/sites. All have SAFETY comments.
  Later phases overrode this Phase-1 confidence for several entries:
  `ConcurrentPromiseTask` / `WorkTask` are EXP-046, `Blob` is EXP-082,
  `VirtualMachine` is EXP-084, and `JsCell<T>` is EXP-045. The remaining
  genuinely clean exemplar in this local list is `SourceLocation`; task-wrapper
  and JS-affinity entries now require the Phase-5/8 remediation plans.
- **`ExternalSharedDescriptor` (3)**: `AbortSignal`, `JSCArrayBuffer`, `Blob`.
  Trait contract: opaque ZST handle + `opaque_ref` non-null deref proof + C++
  refcount FFI. Pattern verified.
- **`bytemuck::NoUninit` (1)**: `IPCMessageType` — `#[repr(u8)]` fieldless enum,
  no padding; safety comment present.
- **`unbounded_queue::Linked` (1)**: `TranspilerJob` — intrusive node accessor.

No `unsafe impl Trait` for `T: !Send`-leaking patterns observed (no `Rc` smuggling,
no manual `Send` over `Cell`-only types).

## Notable patterns

- **`opaque_ffi!` ZST handle** (~25 distinct types in jsc/): backed by
  `PhantomData<UnsafeCell<()>>` + `PhantomPinned`. `&Handle` is ABI-identical
  to a non-null `*const Handle`; C++ mutating through it is interior mutation
  invisible to Rust. **This is the foundation that lets `safe fn` extern
  declarations exist for handle-only signatures**, dramatically reducing the
  count of `unsafe { ffi_call(…) }` blocks in callers.
- **`safe fn` discipline in `unsafe extern "C"` blocks**: 155 extern blocks,
  most contain a mix of `safe fn` (handle-only) and `unsafe fn` (out-params,
  raw `*mut c_void` ctx, consume-allocation). Verified pattern at
  `Strong.rs:259-264`, `Weak.rs:69-79`, `AbortSignal.rs:36-99`,
  `JSCell.rs:76-84`. Phase 2 should spot-check that `safe fn` reasoning holds
  for any newly-added bindings (regression risk).
- **`JsCell<T>`** (`JSCell.rs:118-209`): `#[repr(transparent) UnsafeCell<T>]`
  with `unsafe impl Sync` discharged by single-JS-thread invariant.
  `with_mut(|x| ...)` is the safe entry point; `get_mut()` is `unsafe fn` with
  reentrancy contract. **Foundational to safe `&'static VirtualMachine`
  accessor.**
- **`#[host_fn]` shim emission**: macro emits `// SAFETY:` per shim; R-2
  receiver discipline (`&self` → `&*__this`, `&mut self` → `&mut *__this`)
  prevents Stacked Borrows UB on JS reentry. This is the right shape — the
  alternative (every host method takes `*mut Self` and reborrows internally)
  was rejected because the macro can't statically detect reentry.
- **`bun_core::heap::take`** (Bun's `Box::from_raw` analogue) appears ~30 times
  in jsc/. Every occurrence pairs with a `heap::into_raw`/`heap::alloc` site
  in the same file or an FFI callback contract.
- **`mem::forget` (rare)**: only `ResolvedSource.rs:115` (refcount transfer to
  C++). Documented as "Rust must not touch the strings" after `into_ffi()`.

## Open questions

1. **`Weak<T>` type-level doc gap** — should `Weak.rs:81-95` add an explicit
   `// SAFETY: !Send + !Sync because the underlying HandleSlot must be dropped
   on the JS thread` doc? The auto-trait inference works today but a future
   refactor could break it silently.
2. **`DeprecatedStrong` lacks `PhantomData<*const ()>` marker** — JSValue's
   `!Send + !Sync` propagates through the `raw: JSValue` field, but the type
   doesn't *document* the constraint. Belt-and-suspenders à la `JsRef:113`?
3. **`JSPromise::Weak<T>` get returns `&mut JSPromise` from `&self`** — sound
   under the `opaque_ffi!` ZST argument (zero bytes covered) but worth a
   loom-style proof in Phase 3 that no concurrent caller can see torn state.
4. **`AnyTaskJob<C>` Drop runs on whichever thread last holds the box** —
   init-failure in `create` runs Drop on the JS thread; success path runs
   Drop on the JS thread via `run_from_js`. **What happens if WorkPool
   panic-aborts mid-`run_task`?** Should `AnyTaskJobCtx::run` carry a
   `UnwindSafe` bound or document that panics abort the process?
5. **Phase 2 should fuzz `Strong::Impl::destroy`'s 0x10000 floor on Windows**
   — issue #53265 root cause was unidentified at the time the floor was added;
   if the corrupting writer is now known, the `|| cfg!(windows)` arm of the
   debug check can be removed.
6. **`webcore_types.rs:489` `unsafe impl ExternalSharedDescriptor for Blob`**
   — current source has a SAFETY comment at `:487-488` plus method-level caller
   contracts at `:491/:495`. Phase 3 should verify the ref/deref lifecycle, but
   this is not a missing-comment gap.

## Anchor cross-refs (the prior-audit JSC-adjacent hazards)

Prior-audit executive summary callouts mapped to Section K rows:

- "JSC task / weak-reference wrapper findings remain tracked separately as
  unsafe-contract hazards" → Sections A, B above. **Strongest concentration in
  `any_task_job.rs` (canonical pattern), `Weak.rs` / `Strong.rs` (foundation),
  `RuntimeTranspilerStore.rs` (intrusive queue), `web_worker.rs` (thread
  spawn), `Debugger.rs` (debugger thread).**
- "`bun_jsc::Strong/Weak` thread-affinity-aware and audited as `!Send +
  !Sync`" → confirmed at `Strong.rs:11-15` (explicit doc) and `Weak.rs:81-95`
  (auto-trait, no doc — minor gap). `DeprecatedStrong.rs:56-62` carries the
  contract via JSValue field but does not document it.

No anchored Miri witnesses exist in this section yet (priors list "JSC-task-
weak-reference-wrapper-findings" without a specific reproducer). Phase 2 should
construct a loom model of `AnyTaskJob` lifecycle and a Miri harness that
exercises Strong/Weak Drop ordering across a synthetic shutdown.

## Section K: jsc-core (summary block for `phase1_unsafe_surface_inventory.md`)

Inventory: `phase1_inventory_K.md`. Notes: `phase1_notes/K_jsc.md`.
Sites: **993 unsafe lexemes** (`bun_jsc` 972 + `bun_jsc_macros` 21; prior 745; +248). The
delta is dominated by macro-template growth (`host_fn`/`uws_callback` per-shim
SAFETY-commented unsafe blocks count toward each call site) and the
`hot_reloader.rs` 45 KB → 68 KB rewrite. Strong/Weak audited as
`!Send + !Sync`, **`Weak<T>` and `DeprecatedStrong` lack explicit type-level
Send/Sync docs** (relies on auto-trait inference; minor gap). 23 actual
`unsafe impl` lines; the looser 29 lexeme count included comment references.
JSC task wrappers (AnyTaskJob, WorkTask,
ConcurrentPromiseTask, CppTask, TranspilerJob) confirmed as
`tracked-separately` hazards rather than uniformly clean entries; EXP-046 later
promotes `WorkTask` / `ConcurrentPromiseTask` to missing-`Send`-bound
unsafe-contract defects. Canonical `AnyTaskJob<C>` (`any_task_job.rs`, ~170 LOC)
replaced 5 hand-rolled Zig sites. No `transmute` calls (zero matches).
171 `from_raw`/`assume_init`/`get_unchecked`/`UnsafeCell` lexemes. `safe fn`
discipline in `unsafe extern "C"` blocks (155 blocks) is consistent and
foundationally backed by the `opaque_ffi!` ZST-handle pattern.
