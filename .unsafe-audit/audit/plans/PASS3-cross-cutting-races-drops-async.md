# PASS 3 — Cross-cutting audit: refcount races, FFI drop order, dyn Trait Send, async cancellation, JSC finalizers, cross-crate Send composition

Audit produced 2026-05-15 against `oven-sh/bun@428f61eb34`.

## Executive summary

This pass examines hazards that span multiple subsystems and that the per-file
Pass 2 plans could not fully reason about. Six cross-cutting axes were
examined; the most consequential findings are concentrated in two clusters:

1. **The home-rolled refcount primitives in `src/ptr/` disagree on atomic
   ordering and refcount-revival safety.** `ThreadSafeRefCount` (`ref_count.rs`)
   uses `SeqCst` for every inc/dec, whereas `RawAtomicRefCount`
   (`raw_ref_count.rs`) uses the canonical `Release` decrement + `Acquire`
   fence-at-zero pattern. Both are individually sound, but the SeqCst variant
   is the one used for all FFI-crossing intrusive types (`FetchTasklet`,
   `Process`, `ThreadSafeStreamBuffer`, `ParsedSourceMap`, websocket clients),
   so the cost is paid on every drop. The correctness issue is narrower than
   the first draft claimed: `ref_` is an unsafe primitive whose contract
   requires a live pointee. A release-build revival bug exists only at call
   sites that call `ref_` from a raw pointer without already owning or proving
   a live ref. Add `try_ref` for those paths, but do not count the primitive
   itself as confirmed UB without a bad caller.
2. **Unbounded `unsafe impl<T> Send/Sync for Wrapper<T> {}` impls** in
   `JsCell`, `StoreSlice`, `StoreRef`, `StoreStr`, `BSSList`,
   `MimallocArena`, and several others. The Pass-2 ptr-cast / send-impl
   plans flagged some of these individually; viewed as a cross-cutting
   pattern they are the single largest *latent* soundness debt in the
   Rust port. Today most of them are sound because the wrapped `T` is in
   practice always `Send`-compatible; tomorrow's refactor that puts an
   `Rc`-bearing payload inside one of these wrappers is the failure mode.

A third smaller cluster covers `WeakPtrData`'s non-atomic refcount
(`weak_ptr.rs`), the install pipeline's mixed `pending_tasks` atomic policy,
and the `Cell<*const T>`-bearing `Blob` Send/Sync impl.

### Tiered bug count

| Tier | Count | Examples |
| --- | --- | --- |
| **T1** (confirmed patchable) | 1 | `unsafe impl<T> Send/Sync for StoreSlice<T>` launders `!Send`/`!Sync` payloads; sister `StoreRef<T>` already has the correct bounds |
| **T2** (unsafe-contract / architecture defect) | 8 | `WeakPtrData` non-atomic if cross-thread weak refs exist · `JsCell<T>: Send+Sync` for arbitrary `T` · `Blob: Send+Sync` over `Cell` fields · two divergent atomic-ordering policies for refcounts · `BackRef::get_mut` unchecked exclusivity · `host_fn_finalize` mutator-thread and leak-first assumptions · 157 `unsafe impl Send/Sync` sites with no audit trail · `ThreadSafeRefCount::ref_` needs a checked `try_ref` for raw-pointer handoff paths |
| **T3** (latent watchlist / policy cleanup) | 12 | `pending_tasks` mixed orderings · `FetchTasklet::abort_task` Relaxed cancellation flag · SeqCst on `concurrent_ref`/`OUTSTANDING` is over-strict · `WebWorker::SendPtr` unbounded · `host_fn_finalize` panic-on-impl leaks the +1 to other ref holders (documented in code, not enforced) · `ScopedRef::adopt` consumes a ref without bumping — caller-contract-only · `RefPtr` has no `Drop` (leak on `Option::take` is silent) · `WeakPtr::get` and `deref_internal` require single-thread pointee discipline · `ParentRef` release-build checks are intentionally absent · Spawn `Process::Drop` ordering depends on the default destructor · dyn `SourceData` future-Send hazard · abort listener depends on C++ listener-remove-before-emit ordering |

Total: **21** distinct findings across the six parts after reclassification: 1 T1, 8 T2, 12 T3. This is intentionally stricter than the first Pass 3 draft; several items are real design hazards but not confirmed live UB without a bad caller.

---

## Part 1 — Refcount primitives & races

### 1.0 Inventory

The `ptr` crate (`src/ptr/`) ships **five** refcount-like
primitives:

| Type | File | Storage | Thread-safe? | Memory order |
| --- | --- | --- | --- | --- |
| `RefCount<T>` | `ref_count.rs:233` | `Cell<u32>` + `ThreadLock` | No (debug-asserted) | n/a |
| `ThreadSafeRefCount<T>` | `ref_count.rs:442` | `AtomicU32` | Yes | **SeqCst** inc/dec |
| `RawRefCount` | `raw_ref_count.rs:31` | `u32` (debug `ThreadLock`) | No | n/a |
| `RawAtomicRefCount` | `raw_ref_count.rs:73` | `AtomicU32` | Yes | **Release** dec, `Acquire` fence at 0; **Relaxed** inc |
| `CellRefCounted` trait | `ref_count.rs:653` | implementor-supplied `Cell<u32>` | No | n/a |
| `WeakPtrData` | `weak_ptr.rs:9` | **plain `u32`** | No (no ThreadLock) | n/a |

`IntrusiveRc<T>` is a Phase-A type alias for `RefPtr<T>` (`lib.rs:71`).
`BackRef<T>` is the non-refcounted "owner outlives holder" pointer
(`lib.rs:118`); `ParentRef<T>` is the debug-anchored variant for *mortal*
parents (`parent_ref.rs:149`).

### 1.1 [T2] Two divergent atomic-ordering policies for the same primitive

**Site:** `src/ptr/ref_count.rs:474, 492, 527` vs `src/ptr/raw_ref_count.rs:86, 92`.

`ThreadSafeRefCount::ref_`:

```rust
let old_count = count.raw_count.fetch_add(1, Ordering::SeqCst);  // ref_count.rs:474
```

`ThreadSafeRefCount::deref`:

```rust
let old_count = count.raw_count.fetch_sub(1, Ordering::SeqCst);  // ref_count.rs:492
// ...
if old_count == 1 { /* destructor */ }
```

vs. `RawAtomicRefCount::increment` / `decrement`:

```rust
let old = self.raw_value.fetch_add(1, Ordering::Relaxed);            // raw_ref_count.rs:86
// ...
let old = self.raw_value.fetch_sub(1, Ordering::Release);            // raw_ref_count.rs:92
if old == 1 {
    core::sync::atomic::fence(Ordering::Acquire);                    // raw_ref_count.rs:105
    DecrementResult::ShouldDestroy
}
```

Both are individually sound. The `RawAtomicRefCount` pattern is the canonical
`Arc` ordering (matches `std::sync::Arc::drop`). The `ThreadSafeRefCount` form
is correct but pays a global ordering tax on every ref/deref of every
intrusively-refcounted type that crosses an FFI boundary. Concrete consumers
of `ThreadSafeRefCount`:

- `src/runtime/webcore/fetch/FetchTasklet.rs` — every fetch in flight
- `src/spawn/process.rs:135` — every spawned subprocess
- `src/http/ThreadSafeStreamBuffer.rs:11`
- `src/sourcemap/ParsedSourceMap.rs` (via Pass-2 `bun_runtime` plan)
- `src/jsc/web_worker.rs` and dependents
- `src/install/lifecycle_script_runner.rs` lifecycle scripts

**Recommended fix:** harmonise on the canonical `Release`-dec + `Acquire`-fence
pattern in `ThreadSafeRefCount::deref` (lines 487–510 and the parallel
`release` body at 522–546). For `ref_` (line 469–483), `Relaxed` is correct
*provided* the caller already holds a ref — which is the existing safety
contract. The win is real: `fetch_add(1, SeqCst)` on x86 emits a `lock xadd`
plus serialising memory barriers; `Relaxed` collapses to a plain `lock xadd`.
On the fetch hot path this is per-task overhead.

### 1.2 [T2] `ThreadSafeRefCount::ref_` lacks a checked raw-pointer upgrade path

**Site:** `src/ptr/ref_count.rs:469–483`.

```rust
pub unsafe fn ref_(self_: *mut T) {
    let count = unsafe { &*T::get_ref_count(self_) };
    #[cfg(debug_assertions)]
    count.debug.assert_valid();
    let old_count = count.raw_count.fetch_add(1, Ordering::SeqCst);
    // ...
    debug_assert!(old_count > 0);
}
```

The `old_count > 0` guard is a `debug_assert!`. In release builds, if a caller
hands a raw `*mut T` pointer to another thread without holding the matching
ref, and the original thread drops the last ref between `*mut T` reaching the
second thread and the second thread calling `ref_`, the increment succeeds,
the destructor *may have already run* (re-using the allocation), and the
second thread now has a "live" reference to freed-or-reallocated memory.

`Arc::clone` avoids this via the invariant "you must hold a ref to clone";
the type system enforces that by requiring `&Arc`. `ThreadSafeRefCount::ref_`
takes `*mut T` so the type system cannot enforce the invariant; the comment
("caller contract") simply forwards the obligation.

This is the path that would need CAS-loop refcount-revival behaviour
(à la `Arc::Weak::upgrade`) **if** a caller only has a raw pointer and cannot
prove a live ref. Most call sites are correct by construction: the
cross-thread handoff happens with the +1 ref already taken. Therefore this is
not counted as a confirmed race until a bad caller is identified, but the API
should provide a safe failure mode for future raw-pointer handoffs.

**Recommended fix:** introduce a `try_ref` that performs a CAS-loop and fails
when `old == 0`, then route the unsafe sites in `FetchTasklet`/`Process` (the
cross-thread paths) through that. Keep `ref_` as the fast in-flight path
(caller already holds a ref).

### 1.3 [T2] `WeakPtrData` is a plain `u32` if weak refs ever cross threads

**Site:** `src/ptr/weak_ptr.rs:9–47, 88–139`.

```rust
pub struct WeakPtrData(u32);            // weak_ptr.rs:9
// reference_count: low 31 bits, finalized: bit 31

pub fn init_ref(req: &mut T) -> Self {
    let d = unsafe { &mut *T::weak_ptr_data(req) };
    d.set_reference_count(d.reference_count() + 1);                  // weak_ptr.rs:95
    Self { raw_ptr: Some(NonNull::from(req)) }
}

unsafe fn deref_internal(&mut self, value: NonNull<T>) {
    let weak_data = unsafe { &mut *T::weak_ptr_data(value.as_ptr()) };  // weak_ptr.rs:128
    self.raw_ptr = None;
    let count = weak_data.reference_count() - 1;
    weak_data.set_reference_count(count);
    if weak_data.finalized() && count == 0 {
        drop(unsafe { bun_core::heap::take(value.as_ptr()) });        // weak_ptr.rs:137
    }
}
```

`WeakPtrData` has no `Atomic*` field and no `ThreadLock`. The Zig original
(`weak_ptr.zig`) was a `packed struct(u32)` with the same assumption of
single-thread access, but the Zig codebase enforces thread-affinity
out-of-band through `*VirtualMachine` discipline. The Rust port retains the
same invariant *in comments* (`init_ref` takes `&mut T`, which prevents
*compile-time* multi-thread aliasing of the wrapper) but the data structure
itself is the pointee of `T::weak_ptr_data(value.as_ptr())` — every
`WeakPtr<T>` from a fresh `init_ref(req)` aliases the same `WeakPtrData`
inside `*req`. If `T: Sync` (and it usually is, because it lives in a
`JsCell` or similar), two threads can each have an `&mut WeakPtr<T>` whose
`deref_internal` calls aliase the same `WeakPtrData` — a data race on the
non-atomic `u32`.

The `set_reference_count` path also masks the high bit:

```rust
self.0 = (self.0 & Self::FINALIZED_BIT) | (n & Self::REF_MASK);     // weak_ptr.rs:25
```

— a non-atomic read-modify-write. If thread A is in `set_reference_count(n+1)`
and thread B is in `on_finalize`, the final `finalized` bit can be lost.

The current observed safe operation depends on `T::weak_ptr_data` only being
exercised from one thread — usually the JS thread, since GC finalize and JS
deref both run there. This pass did not prove a current cross-thread
`WeakPtr<T>` user. But the *type system does not enforce this*; any new caller
that takes `&mut WeakPtr<T>` on a worker thread will silently corrupt.

**Recommended fix:** replace `WeakPtrData(u32)` with `AtomicU32` and switch
the read-modify-write helpers to CAS loops. Same wire-format, byte-compatible
layout (the FINALIZED_BIT/REF_MASK split survives), no caller change required.

### 1.4 [T3] `pending_tasks` mixed ordering policy (install pipeline)

**Sites:**

- `src/install/PackageInstall.rs:735`: `pending_tasks.fetch_sub(1, Ordering::Release);`
- `src/install/PackageInstall.rs:2098`: `pending_tasks.fetch_add(1, Ordering::Relaxed);`
- `src/install/PackageManager/runTasks.rs:1592`: `pending_tasks.fetch_add(count, Ordering::Relaxed);`
- `src/install/PackageManager/runTasks.rs:1597`: `pending_tasks.fetch_sub(1, Ordering::Release);`
- `src/install/PackageManager/runTasks.rs:1583`: `pending_tasks.load(Ordering::Acquire)`

The reader pairs `Acquire` with the writer's `Release` decrement, while the
increments are `Relaxed`. The first draft treated this as a T1 ordering bug,
but source review did not show non-atomic payload data being published through
this counter. The work queue itself is mutex-protected; `pending_tasks` appears
to be a completion metric. Under that interpretation the mixed orderings are
confusing and over-specified, not a proven race.

The mixed `Release/Relaxed`/`Acquire/Relaxed` shape suggests the original
Zig used `monotonic`/`acquire`/`release` in slightly different places and
the port was mechanical. Either:

- The counter is a pure metric → all `Relaxed`.
- The counter publishes work → both inc and dec are `Release` and reads are `Acquire`.

**Recommended fix:** audit the four sites together and document the policy.
The likely answer is "all Relaxed" given the mutex protects the queue. If a
future claim says the counter publishes work, the artifact must name the
payload reader that relies on the Acquire load.

### 1.5 [T2] `BackRef::get_mut` has no compile-time exclusivity check

**Site:** `src/ptr/lib.rs:178–182`.

```rust
pub unsafe fn get_mut(&mut self) -> &mut T {
    // SAFETY: caller guarantees exclusivity; BackRef invariant guarantees
    // liveness/alignment.
    unsafe { self.0.as_mut() }
}
```

`BackRef<T>` is `Copy` (`lib.rs:185`). `Copy` + `get_mut` taking `&mut self`
is illusory uniqueness: the borrow checker can prevent two `&mut BackRef`s
simultaneously, but the holder can `let copy = *backref; copy.get_mut();`
and now two `&mut T` exist. The doc comment delegates the obligation to the
caller, but the *type* lies.

**Recommended fix:** make `BackRef` `!Copy` *or* remove `get_mut` and route
mutation through `as_ptr()` + per-site `unsafe { &mut *p }`. The latter
matches the existing pattern in `ParentRef` (`parent_ref.rs:340` has
`assume_mut` consuming `self` by value).

### 1.6 [T3] `LiveMarker` is release-build-blind

**Site:** `src/ptr/parent_ref.rs:49–118`.

`LiveMarker` is `cfg(debug_assertions)`-gated. In release builds the
`generation` field disappears, `assert_live` is a no-op, and a stale
`ParentRef` reads through a dangling raw pointer with **no panic, no
assertion, just UB**. The doc comment is explicit about this (line 49: "Debug:
… Release: ZST"). T3 because the panic-instead-of-UAF behaviour is debug-only
by design; the architecture invariant is "release builds never have stale
ParentRefs because the construction pattern proves it." If a stale ParentRef
ever does escape in release, the symptom is a silent segfault, not a
diagnostic.

This is a deliberate trade-off, but worth noting: there is **no defense in
depth**. A Pass-3 recommendation: in release builds, replace the snapshot
with a single-bit liveness flag (one byte, branch-on-false to panic) that
still costs nothing on the hot path but converts "silently dereferences a
freed allocation" into "panics in `get()`". This survives more refactors.

---

## Part 2 — Drop order at FFI boundaries

### 2.0 Inventory of paired-destruction types

A type has "two destruction paths" if it has *both* a Rust `Drop` impl *and*
an `extern "C" fn` finalizer that may run independently. The following are
the audited sites; the rest of the surface uses one path or the other but
not both.

| Type | Rust `Drop` | C finalizer | Sequencing |
| --- | --- | --- | --- |
| `Process` (`src/spawn/process.rs:141`) | `poller.deinit()` | `on_close_uv` (line 575) | C cb runs first → drops a ref → destructor runs `Box::from_raw` → Drop body runs |
| `WebSocket<SSL>` (`src/http_jsc/websocket_client.rs:1972`) | None (intrusive deinit at line 2006) | `finalize` (line 1972) | Finalize drops the wrapper's +1; if last, `deinit` runs and `clear_data` runs |
| `FetchTasklet` (`src/runtime/webcore/fetch/FetchTasklet.rs:481`) | None | None directly; intrusive `deinit` runs at last deref | `deref_from_thread` (line 374) bounces to main thread for `deinit` |
| `napi_finalize` (`src/runtime/napi/napi_body.rs:2435`) | n/a | Yes | Deferred to the immediate task queue (line 2427); runs same-thread |
| `uv_signal_handle_windows` (`src/runtime/node/uv_signal_handle_windows.rs:49`) | None | `free_with_default_allocator` | Single allocation; `Box::from_raw` reclaims and drops in C cb |
| `RefString` (`src/jsc/VirtualMachine.rs:2998`) | None | `free_ref_string` | C-callback frees the Rust allocation |
| `SSLContextCache` (`src/runtime/api/bun/SSLContextCache.rs:250`) | None directly | `bun_ssl_ctx_cache_on_free` | Single path |

### 2.1 [T3] `Process::Drop` ordering depends on the default `destructor`

**Site:** `src/spawn/process.rs:129–148`.

```rust
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct Process { /* … */ ref_count: ThreadSafeRefCount<Process>, /* … */ }

impl Drop for Process {
    fn drop(&mut self) {
        self.poller.deinit();
    }
}
```

The default `ThreadSafeRefCounted::destructor` is `drop(Box::from_raw(this))`
(`ref_count.rs:114`). `Box::from_raw(this)` runs `Drop::drop(&mut *self)`
first (which runs `poller.deinit()`), *then* deallocates.

So today the order is: refcount hits 0 → destructor called → `Box::from_raw`
→ `Drop::drop` runs `poller.deinit()` → memory freed. **Sound today.**

The fragility: if anyone overrides `destructor` to return the allocation to a
pool (`Process::destructor(this) { POOL.put(this); }`) and forgets to call
`Drop::drop` first, `poller.deinit()` never runs, leaking libuv handle
state. The current implicit-Drop chain is hidden behind the codegen.

**Recommended fix:** make the `ThreadSafeRefCounted::destructor` doc
*explicit* that the default reclaims via `Box::from_raw` (which runs `Drop`),
and that overrides MUST either call `Box::from_raw` themselves or
`ptr::drop_in_place(this)` before reclaiming the allocation. A `#[doc]`
warning is cheaper than a runtime check.

### 2.2 [T2] `host_fn_finalize` assumes mutator-thread sweep

**Site:** `src/jsc/host_fn.rs:622–631`.

```rust
pub fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(Box<T>)) {
    let boxed = unsafe { Box::from_raw(this) };  // host_fn.rs:629
    f(boxed)
}
```

The SAFETY comment says: "`this` is the GC-owned `m_ctx` pointer, valid and
not concurrently accessed (mutator-thread sweep)." This is true for *current*
JSC: every GC finalizer runs on the same thread as the mutator (confirmed by
`src/jsc/bindings/bindings.cpp:2907`'s
`ASSERT_WITH_MESSAGE(!vm.isCollectorBusyOnCurrentThread(), …)`).

If JSC ever introduces a parallel finalize sweep (some VMs do — e.g. V8's
incremental marking can hand finalizers to a helper thread), this
`Box::from_raw` becomes UAF: another thread could have a raw `*mut T` to the
same allocation. For intrusively-refcounted `T` the comment at line 617 calls
out the obligation ("MUST `Box::leak`/`Box::into_raw` as its FIRST step"),
but the obligation is on the user's `f`, not enforced.

**Recommended fix:** keep the assumption (it's load-bearing for performance)
but add a `#[cfg(debug_assertions)]` check that the calling thread matches
the VM's mutator thread. Falsifies the assumption immediately on any future
JSC change.

### 2.3 [T2] 157 `unsafe impl Send/Sync` sites with inconsistent justification

Inventory: `jq '. | select(.categories | index("send_impl") or index("sync_impl"))' …` reports 157 unique
`unsafe impl (Send|Sync)` blocks. Of these:

- ~60 are generic over `T` with a `T: Send` (or stricter) bound — sound by composition.
- ~50 are non-generic with a SAFETY comment naming a specific thread-affinity invariant.
- ~30 are **unbounded generics** (`unsafe impl<T> Send for X<T>`) — these are the architecturally hazardous ones.
- ~15 are pre-Pass-2 leftovers (`unsafe impl Sync for ThreadCell<T>` etc.) where Pass 2 already filed remediation.

The cross-cutting concern: there is **no central registry** mapping each
`unsafe impl` to the invariant that discharges it. A reviewer touching
`StoreSlice<T>` cannot easily verify that the impl at `ast/nodes.rs:339`
is still sound after a new caller. The Pass-2 `C-003-send-sync-impls.md` plan
addressed individual sites but did not push for the registry.

**Recommended fix:** annotate each `unsafe impl` with one of the standard
invariant tags:

```rust
// SAFETY-AFFINITY: js-thread-only (VirtualMachine::ON_THREAD asserted at every public entry)
unsafe impl<T> Send for JsCell<T> {}
```

then add a `tools/audit-send-sync.sh` that greps for missing tags and fails
CI. Cheap, mechanical, surfaces every new addition.

### 2.4 [T3] `WebSocket::finalize` forms `&mut *this_ptr` while a `ScopedRef` is live on the same pointer

**Site:** `src/http_jsc/websocket_client.rs:1972–2002`.

```rust
pub extern "C" fn finalize(this_ptr: *mut Self) {
    let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };  // ref_count.rs:1011 — bumps refcount via raw projection
    let this = unsafe { &mut *this_ptr };                       // websocket_client.rs:1982 — &mut Self over the same allocation
    this.clear_data();
    // ...
}
```

`ScopedRef::new` (`ref_count.rs:1011`) calls `T::rc_ref(ptr)` which projects
to the embedded `Cell<u32>`/`AtomicU32` via raw pointer projection (per
`CellRefCounted::ref_count_raw` doc, `ref_count.rs:667`). The doc explicitly
calls out that this is sound because it never materialises a whole-struct
`&Self`. So `_guard` exists as `NonNull<T>` only; no `&T`/`&mut T` is held
across `clear_data`'s body.

This is the *intended* idiom — Pass 2 reviewed similar patterns. T3 because
it depends on the contract that `T::rc_ref`'s implementation does not form a
whole-struct borrow. The derive (`bun_ptr::CellRefCounted` /
`bun_ptr::ThreadSafeRefCounted` in `bun_core_macros`) **must** emit code that
projects via `addr_of_mut!`, not via `&mut self.ref_count`. If the derive
ever regresses to the latter (under pressure to support `#[track_caller]` /
better diagnostics), every Rust-Drop-while-ref-guarded site silently breaks.

**Recommended fix:** add a regression test that compiles a synthetic
`#[derive(CellRefCounted)]` type and uses `cargo +nightly miri test` to
catch any Stacked-Borrows violation. This is the only mechanical defense
against derive regression.

---

## Part 3 — `Box<dyn Trait>` / `Arc<dyn Trait>` Send/lifetime

Compared with the typical Rust application, Bun makes very sparing use of
trait objects: `grep -rn 'Box<dyn '` returns ~10 hits total, and `Arc<dyn`
returns **zero** hits. This is consistent with the porting philosophy (Zig
has no trait objects; the port favours enums and generics).

### 3.0 Inventory

| Site | Shape | Send bound? |
| --- | --- | --- |
| `src/crash_handler/lib.rs:614` | `Box<dyn Fn(*mut c_void) + Send>` | Yes |
| `src/install_types/resolver_hooks.rs:1616` | `Box<dyn Iterator<Item = …> + '_>` | No (single-thread iter) |
| `src/resolver/package_json.rs:320` | `Box<dyn Iterator<Item = …> + '_>` | No |
| `src/spawn/lib.rs:202` | `Box<dyn SourceData>` | **No** — implicit `'static` |
| `src/runtime/crypto/CryptoHasher.rs:796` | `Box<dyn Any>` | No (single-thread) |

`Box<dyn SourceData>` deserves a closer look.

### 3.1 [T3] `Source::Any(Box<dyn SourceData>)` has implicit `'static` and no Send bound

**Site:** `src/spawn/lib.rs:200–204`.

```rust
pub enum Source {
    OwnedBytes(Box<[u8]>),
    Any(Box<dyn SourceData>),       // implicit `+ 'static`
    Detached,
}

pub trait SourceData {
    fn slice(&self) -> &[u8];
    fn detach(&mut self);
    fn memory_cost(&self) -> usize { 0 }
}
```

`Source` is consumed by `StaticPipeWriter<P>`. `StaticPipeWriter` runs on
either the JS thread (when the impl is `bun_runtime::api::bun::subprocess`)
or on the calling thread (`bun_install::security_scanner`). The trait is not
`Send`, so the compiler will reject any attempt to send a `Source::Any`
across threads — but the same compiler will also reject sending the entire
`StaticPipeWriter<P>` if `P` is non-`Send`, so today this is enforced by
composition.

The hazard: a future `impl SourceData for SomeBlobAdaptor` whose backing JS
handle is a `Strong` (which is `!Send`) will silently break the auto-trait
inference of `Source`. Today there is no compile-time signal that says
"Source must stay !Send for correctness." If a future
`unsafe impl Send for SomeWrapper<Source>` ever lands, the trait object
ferries a JSC handle to a worker thread.

**Recommended fix:** add a marker `unsafe trait SourceData: !Send` — Rust
doesn't have negative bounds, so the actual mechanism is a `PhantomData<*const ()>`
field in the trait's required associated type. Or, simpler, just type the
trait as `dyn SourceData + Send` if and only if every concrete impl is
demonstrably `Send`. The JSC-tier wrappers will then refuse to compile.

### 3.2 [T3] `Box<dyn Iterator<…> + '_>` lifetime erasure

**Site:** `src/install_types/resolver_hooks.rs:1616`, `src/resolver/package_json.rs:320`.

```rust
fn dependency_iter(&self) -> Box<dyn Iterator<Item = (&[u8], &Dependency)> + '_>;
```

The `+ '_` correctly ties the iterator's lifetime to `&self`, which is the
correct shape. The risk would be `+ 'static` — but neither site uses that.
Mention here only because it's the *correct* pattern and a counter-example
to `Source::Any`'s implicit-static problem above.

---

## Part 4 — Async cancellation deep audit

### 4.0 Scope

Three primary cancel/abort surfaces:

- `Bun.spawn` → `Process::kill` (`src/spawn/process.rs:657`) and the libuv close path (`on_close_uv` line 575)
- `fetch()` → `FetchTasklet::abort_task` (`src/runtime/webcore/fetch/FetchTasklet.rs:1981`)
- `ReadableStream` → `cancel`/`cancel_with_reason`/`abort` (`src/runtime/webcore/ReadableStream.rs:237/249/255`)
- `Bun.serve` → `NodeHTTPResponse::abort` (`src/runtime/server/NodeHTTPResponse.rs:1159`)
- `ResumableSink::cancel` (`src/runtime/webcore/ResumableSink.rs:407`)

### 4.1 [T3] `FetchTasklet::abort_task` uses `Relaxed` for the aborted flag

**Site:** `src/runtime/webcore/fetch/FetchTasklet.rs:1981–1988`.

```rust
pub fn abort_task(&mut self) {
    self.signal_store.aborted.store(true, Ordering::Relaxed);    // FetchTasklet.rs:1982
    self.tracker.did_cancel(&self.global_this);

    if let Some(http_) = self.http.as_mut() {
        http::http_thread().schedule_shutdown(http_);
    }
}
```

The HTTP thread reads the flag via `Signals::get` which also uses `Relaxed`
(`src/http/Signals.rs:52`). All other write sites do the same
(`FetchTasklet.rs:1018, 1043, 1068`). Same pattern in `http/HTTPThread.rs:864,
887` and `http/h2_client/ClientSession.rs:338, 850, 927`.

The first draft called this a T1 ordering bug. That is not proved by the
source alone. A standalone cancellation flag may use `Relaxed` if no
non-atomic payload is published through it and stale reads merely delay
cancellation. `schedule_shutdown` has its own queue synchronization, so the
flag is not the only ordering edge in the shutdown path. To promote this back
to T1, the audit must name a cross-thread reader that observes `aborted` and
then reads non-atomic payload state whose publication depends on this flag.

The cheap hardening remains reasonable: `Release` on writes and `Acquire` on
opportunistic polling reads makes the intended publication model explicit if
future code starts hanging payload state off the flag.

**Recommended fix:** all five `signal_store.aborted.store(_, _)` writes in
`FetchTasklet.rs` (lines 1018, 1043, 1068, 1387 read, 1952 read, 1982 write)
→ `Release`/`Acquire`. Same for `Signals::get` (line 52).

### 4.2 [T3] `FetchTasklet::abort_listener` may be invoked after `clear_data` has run

**Site:** `src/runtime/webcore/fetch/FetchTasklet.rs:1818–1840`.

```rust
pub fn abort_listener(&mut self, reason: JSValue) {
    let this = self;
    reason.ensure_still_alive();
    this.abort_reason.set(&this.global_this, reason);    // FetchTasklet.rs:1822
    this.abort_task();
    if let Some(sink) = this.sink_mut() {
        sink.cancel(reason);
        return;
    }
    if this.is_waiting_request_stream_start {
        if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
            this.is_waiting_request_stream_start = false;
            if let Some(stream) = stream_ref.get(&this.global_this) {
                stream.cancel_with_reason(&this.global_this, reason);
            }
        }
    }
}
```

The abort listener fires from C++ (the WebCore `AbortSignal`'s
`addAlgorithm`). The C++ side holds the JS thread when it invokes the
listener, so re-entry into Rust on the same thread is fine. The hazard is
that the listener is registered (line 1812:
`signal.add_listener(fetch_tasklet_ptr.cast::<c_void>(), Self::__abort_listener_c);`)
with a raw `*mut FetchTasklet` and the listener is removed in
`clear_abort_signal` — but `clear_abort_signal` is called from
`clear_data` (line 474), and `clear_data` is called from `deinit` (line 489).

If C++ fires the abort listener *concurrently* with the JS thread running
`deinit`, the `*mut FetchTasklet` is dangling at the moment the C++ code
walks its callback list. The single-thread invariant for JS callbacks
prevents *concurrent* entry, but if the C++ AbortSignal stores the callbacks
in a vector and a "remove + emit" race happens, this is a UAF.

This is T3 because the actual race requires C++ machinery to misbehave — the
listener removal is documented to happen *before* the callbacks are touched.
Listed here so that any change to `AbortSignal::removeAlgorithm` semantics on
the C++ side surfaces this Rust path as a dependency.

### 4.3 [T3] `Process::kill` does not transition state observably

**Site:** `src/spawn/process.rs:657–700`.

`kill(signal)` calls `libc_kill` (or `Process::Pipe::kill` on Windows) and
returns. It does *not* mark the process as aborted in the way `FetchTasklet`
does. The state machine relies on the OS delivering SIGTERM/SIGKILL and
libuv's `on_exit_uv` callback firing. Between the `kill` syscall and the
callback firing, `Process::has_killed()` returns `false` and the process is
not "in" the killed state.

Today every consumer (`Bun.spawn`'s test harness, `bun install`'s
lifecycle scripts) waits for the exit callback before treating the process
as dead. T3 because no code path appears to observe `has_killed()` *between*
the syscall and the callback.

### 4.4 Cancellation paths summary

The cancellation surface is **uniformly small and well-bracketed**: every
cancel/abort entry point in the audited list either runs synchronously
to completion on the JS thread (Bun.serve, ReadableStream, ResumableSink)
or routes through a documented thread-bouncing primitive (`deref_from_thread`
in FetchTasklet, `schedule_shutdown` in fetch's HTTP thread,
`enqueue_concurrent` for libuv callbacks). The only real audit-time findings
were the atomic-ordering shape (4.1) and the dependency on the C++ side's
listener-remove-before-emit ordering (4.2).

---

## Part 5 — JSC GC finalizer aliasing audit

### 5.0 JSC thread model

Confirmed via `src/jsc/bindings/bindings.cpp:2907`:

```cpp
ASSERT_WITH_MESSAGE(!vm.isCollectorBusyOnCurrentThread(),
    "Cannot call function inside a finalizer or while GC is running on same thread.");
```

JSC finalizers run on the mutator thread (the JS thread that owns the VM).
There is no cross-thread finalize hazard *for purely-JS state*. The hazards
identified here are about Rust-side state that the finalizer touches.

### 5.1 Finalizer sample (n=12)

| Type | Finalizer site | Reads/writes |
| --- | --- | --- |
| Generated `${T}Class__finalize` | `src/jsc/host_fn.rs:622` (`host_fn_finalize`) | `Box::from_raw(this)` |
| `JSSink::js_finalize` | `src/codegen/generate-jssink.ts:1132` (codegen) | `this.detachJS()` |
| `WebSocket<SSL>::finalize` | `src/http_jsc/websocket_client.rs:1972` | `clear_data`, intrusive deref |
| `napi_internal_enqueue_finalizer` | `src/runtime/napi/napi_body.rs:2435` | deferred via task queue |
| `napi_finalize` | (codegen, generate-jssink) | per-class wrapper |
| `free_ref_string` | `src/jsc/VirtualMachine.rs:2998` | `RefString::destroy` |
| `bun_ssl_ctx_cache_on_free` | `src/runtime/api/bun/SSLContextCache.rs:250` | `SSLContextCache` entry drop |
| `OPENSSL_memory_free` | `src/boringssl/lib.rs:217` | OpenSSL slab free |
| `mi_free_opaque` | `src/bun_alloc/c_thunks.rs:42` | mimalloc free |
| `ZigString__free` / `ZigString__freeGlobal` | `src/jsc/ZigString.rs:87/106` | `String`'s heap-alloc free |
| `json_ipc_data_string_free_cb` | `src/jsc/ipc.rs:454` | IPC `bool` flip |
| `process_deferred_frees_thunk` | `src/io/posix_event_loop.rs:1446` and `windows_event_loop.rs:358` | drain a queue of deferred frees |

### 5.2 [T2] `host_fn_finalize` requires user impl to `Box::leak`/`into_raw` first for intrusively-refcounted T

**Site:** `src/jsc/host_fn.rs:610–631`.

The doc comment (lines 610–620) explicitly states:

> For intrusively-refcounted `T` the JS wrapper holds one of N refs; the
> impl MUST `Box::leak`/`Box::into_raw` as its FIRST step (before any
> fallible work) so the allocation is not freed by Box drop on panic while
> other ref holders still alias it.

This is an obligation on user code. There is no enforcement. A finalizer
that takes `Box<T>` and panics before leaking it will drop the `Box`, freeing
the allocation, while another thread still holds a `*mut T` raw pointer.
Subsequent access UAFs.

The `finalize_js_box` helper (`src/ptr/ref_count.rs:177–189`) is the safe
wrapper:

```rust
pub fn finalize_js_box<T, F>(boxed: Box<T>, before: F)
where T: AnyRefCounted, /* … */
{
    let ptr: *mut T = Box::into_raw(boxed);    // ref_count.rs:183 — leak FIRST
    before(unsafe { &*ptr });                  // ref_count.rs:186 — &T only
    unsafe { T::rc_deref(ptr) };               // ref_count.rs:188
}
```

Every JS finalizer that wraps an intrusively-refcounted Rust type *should*
call this. Today the codegen (`src/codegen/generate-classes.ts:2901`) emits:

```rust
host_fn::host_fn_finalize(this, |b| ${T}::finalize(b))
```

i.e. it hands the impl a `Box<T>`, not a `&T` after `Box::into_raw`. The
impl is on the hook to do the leak.

**Recommended fix:** change the codegen template to:

```rust
host_fn::host_fn_finalize(this, |b| bun_ptr::finalize_js_box(b, |t| ${T}::finalize(t)))
```

for any class declared in `.classes.ts` with `intrusive_refcount: true`.
Mechanical, surfaces every miss at compile time (signature change).

### 5.3 [T2] JSC finalizer crossing into worker-thread-allocated state

JSC finalizers run on the mutator thread, but they may touch state that was
*allocated* on a worker (HTTP, threadpool). Specifically:

- `FetchTasklet::deinit` (`src/runtime/webcore/fetch/FetchTasklet.rs:481`) is
  called from the JS thread but `clear_data` reaches into
  `self.url_proxy_buffer`, `self.metadata`, `self.response_buffer` — all of
  which were *written* on the HTTP thread.
- The CLAUDE.md note about "Cross-thread string hazards" (in
  `src/CLAUDE.md`) calls out this exact bug class for `AtomString`s.

The Pass-2 plan `PASS2-jsc-invariants-and-ffi.md` (60 KB, line 1–60000) covers
the specific `String::clone_utf8` vs atomized-string fix. The cross-cutting
observation here:

**Every JSC-finalize path that consumes worker-thread-allocated state must
free that state on the JS thread, and every type whose `Drop` runs on a
worker thread must NOT touch JSC handles.** This invariant has no compile-time
check. The CLAUDE.md guidance is the only enforcement. T2 because it's
a permanent architectural exposure.

**Recommended fix:** introduce a marker trait `JsThreadOnly` (a `PhantomData<*const ()>`
ZST) that types like `bun_jsc::Strong` carry. `unsafe impl<T> Send for X<T>`
on a wrapper that contains a `JsThreadOnly`-marked field becomes a compile
error. This catches the failure mode at the type-system level rather than at
review time.

---

## Part 6 — Cross-crate `Send` composition

### 6.0 The cross-crate Send-composition problem

`Wrapper<T>` may be `Send` if `T: Send`. When composed, `Wrapper<Wrapper2<T>>`
may be `Send` if `Wrapper2<T>: Send` iff `T: Send`. Provided every wrapper in
the chain carries a `T: Send` bound on its `unsafe impl Send`, the
composition is sound by induction. **The break occurs when any wrapper has an
unbounded `unsafe impl<T> Send`**, because that wrapper silently asserts
`Send` regardless of the payload.

### 6.1 Inventory of unbounded `unsafe impl<T> Send`

| Site | Wrapper | Risk |
| --- | --- | --- |
| `src/ast/nodes.rs:339–340` | `StoreSlice<T>` | Wraps a `NonNull<T>` arena pointer. If T is `!Send` (e.g. contains `Rc`), composition lies. |
| `src/bundler/BundleThread.rs:173` | `SendPtr<T>` (newtype) | Local pattern: "send this pointer across threads". The whole point of the type is to launder `Send`. |
| `src/jsc/JSCell.rs:126, 128` | `JsCell<T>` | Wraps `UnsafeCell<T>`. The single-thread-affinity invariant defends the soundness in practice, but composition assertions break for any `JsCell<NonSendInner>`. |
| `src/runtime/dns_jsc/dns.rs:107` | `SendPtr<T>` | Same as `BundleThread::SendPtr`. |

Plus indirect: `BackRef<T>` (`src/ptr/lib.rs:627`) and `ParentRef<T>`
(`src/ptr/parent_ref.rs:406`) carry `T: ?Sized + Sync` bounds — sound, but
the surrounding type system still allows `BackRef<NonSendThing>` to be Send
via the `T: Sync ⇒ &T: Send` rule (which is the std rule, not a Bun
invention). Worth noting for completeness.

### 6.2 [T2] `unsafe impl<T> Send for JsCell<T>` is too broad

**Site:** `src/jsc/JSCell.rs:118–128`.

```rust
#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

unsafe impl<T> Sync for JsCell<T> {}    // JSCell.rs:126
unsafe impl<T> Send for JsCell<T> {}    // JSCell.rs:128
```

The doc comment (lines 99–117) is explicit that the only reason these impls
exist is so that `&'static VirtualMachine` can satisfy `'static`-bound
closures, and **not** to license cross-thread `get_mut`. But the type system
does not encode this. A user writing
`fn send_it<X: Send>(x: X) { … }` and calling
`send_it(JsCell::new(Rc::new(0)))` compiles cleanly, sends a non-Send `Rc`
across threads, and corrupts the refcount.

In practice this never happens because:

- `JsCell` is only embedded in `VirtualMachine` and JS-heap-adjacent structs.
- `VirtualMachine` is JS-thread-only by convention.

But no in-tree live caller was identified that actually performs this send.
The type-system lie is the cross-cutting hazard, so classify this as a T2
unsafe-contract defect unless a concrete current misuse is found.

**Recommended fix:**

```rust
unsafe impl<T: Send> Send for JsCell<T> {}
unsafe impl<T: Send> Sync for JsCell<T> {}
```

This is strictly stronger than the current impl. The single existing field
of type `JsCell<X>` with `X: !Send` (if any) would fail to compile, signalling
exactly the architectural mistake to fix.

Call-site scan:

```bash
$ rg 'JsCell<' src/ | head -30
```

The non-`Send` payloads I observed in `JsCell<…>` fields are all
JS-thread-bound types that *should* be `!Send`:

- `JsCell<Option<StoreRef>>` in `Blob` (`src/jsc/webcore_types.rs`)
- `JsCell<Strong>` patterns in JSC types

For each, requiring the `Send` bound on `JsCell` either succeeds (if the
inner type is genuinely `Send`) or surfaces a real soundness issue.

### 6.3 [T1] `unsafe impl<T> Send for StoreSlice<T>` is unsound for arbitrary T

**Site:** `src/ast/nodes.rs:336–340`.

```rust
// SAFETY: same rationale as `StoreStr` — points into a single-threaded bump
// arena. Asserted Send/Sync so payload types can sit in `static` Prefill
// tables; callers must not actually share a Store across threads.
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}
```

`StoreSlice<T>` is a `(NonNull<T>, u32)` arena slice. If `T: !Send` (e.g.
contains a `Cell`), then sending `StoreSlice<T>` across threads is unsound
because the receiving thread can read out the slice and observe a
non-Send-but-supposedly-Send `T`.

The justification ("payload types can sit in `static` Prefill tables") is
unrelated to whether the slice itself can cross threads.

**Recommended fix:** `unsafe impl<T: Send> Send for StoreSlice<T>` and
`unsafe impl<T: Sync> Sync for StoreSlice<T>`. The "static Prefill tables"
use case is already satisfied because static globals of `T: Send + Sync`
work as today; only static globals of `T: !Send` would break, which is the
exact bug this would surface.

Same change applies to `StoreRef` (`src/ast/nodes.rs:39–40`) which already
has `T: Send`/`T: Sync` bounds — but a sibling fix.

### 6.4 [T2] `Blob: Send + Sync` over `Cell<*const T>` is the most aggressive `unsafe impl Send` in the repo

**Site:** `src/jsc/webcore_types.rs:84–96`.

```rust
pub struct Blob {
    pub global_this: Cell<*const JSGlobalObject>,                    // webcore_types.rs:84
    pub last_modified: Cell<f64>,
    pub name: bun_core::OwnedStringCell,
    // ... + Cell<*const [u8]> for content_type
}

unsafe impl Send for Blob {}    // webcore_types.rs:95
unsafe impl Sync for Blob {}    // webcore_types.rs:96
```

`Cell<*const T>` is `!Send + !Sync` by default. The `unsafe impl Send for
Blob` overrides both. The justification (lines 90–94) says the data is
heap-owned or "an opaque JSC handle only ever dereferenced on its owning JS
thread."

The hazard: if a Blob whose `global_this` was just set is sent to a worker
thread, the worker reads the pointer via `Cell::get`. The pointer is valid
(JSGlobalObject is process-lifetime), but if the worker *uses* it to call
into JSC, it crashes.

This is documented as "moves … under `ObjectURLRegistry`'s mutex and via the
work-pool read/write tasks", which means the existing Send is load-bearing
for ObjectURLRegistry and the work-pool blob I/O paths. So you can't just
remove the impl.

**Recommended fix:** split `Blob` into two types — `BlobOnJsThread` (with
`global_this`) and `BlobOnWorker` (without). The Send impl moves to
`BlobOnWorker` only. The cross-thread sites in `ObjectURLRegistry` /
`fs.read_file_blob` take `BlobOnWorker`. The conversion is checked at the
boundary.

This is a larger refactor than the StoreSlice fix and remains T2
architecture-tier unless a concrete current cross-thread `&Blob` mutation path
is shown.

---

## 50–80 representative sites

Below: one row per audited site, with the path and an audit verdict.
Sites are drawn from the unsafe inventory (`unsafe-inventory.jsonl`) filtered
by the categories `send_impl`, `sync_impl`, `atomic`, `pin_unchecked`, and
the specific files studied in Parts 1–6.

### Refcount primitives (Part 1)

1. `src/ptr/ref_count.rs:265` — `RefCount::ref_` (single-threaded) — debug ThreadLock asserted, SAFE.
2. `src/ptr/ref_count.rs:292` — `RefCount::deref` — runs destructor at 0, single-threaded; SAFE.
3. `src/ptr/ref_count.rs:469` — `ThreadSafeRefCount::ref_` — SeqCst inc, debug `old > 0` assert; **T2 checked-upgrade hardening (see §1.2)**.
4. `src/ptr/ref_count.rs:487` — `ThreadSafeRefCount::deref` — SeqCst dec, **T2 over-strict ordering (§1.1)**.
5. `src/ptr/ref_count.rs:522` — `ThreadSafeRefCount::release` — same shape as deref; same finding.
6. `src/ptr/ref_count.rs:386` — `RefCount::clear_without_destructor` — single-threaded SAFE.
7. `src/ptr/ref_count.rs:606` — `ThreadSafeRefCount::clear_without_destructor` — Relaxed store SAFE (caller about to free).
8. `src/ptr/ref_count.rs:680` — `CellRefCounted::destroy` (default) — `Box::from_raw` SAFE.
9. `src/ptr/ref_count.rs:703` — `CellRefCounted::deref` — projects via `ref_count_raw`, SAFE (no `&Self` formed).
10. `src/ptr/ref_count.rs:1033` — `ScopedRef::drop` — calls `T::rc_deref(self.0.as_ptr())`, SAFE under invariant.
11. `src/ptr/raw_ref_count.rs:86` — `RawAtomicRefCount::increment` — Relaxed inc with debug overflow check; SAFE.
12. `src/ptr/raw_ref_count.rs:92` — `RawAtomicRefCount::decrement` — Release dec + Acquire fence; canonical Arc pattern, SAFE.
13. `src/ptr/weak_ptr.rs:9` — `WeakPtrData(u32)` — **T2 non-atomic if cross-thread weak refs exist (§1.3)**.
14. `src/ptr/weak_ptr.rs:101` — `WeakPtr::deref` — &mut self, but data race possible via aliased `T::weak_ptr_data`.
15. `src/ptr/weak_ptr.rs:125` — `WeakPtr::deref_internal` — same.
16. `src/ptr/lib.rs:118` — `BackRef<T>` declaration; `Copy` + `get_mut(&mut self) -> &mut T`; **T2 false-exclusivity (§1.5)**.
17. `src/ptr/lib.rs:127` — `BackRef::new(&T)` — Safe wrapping of `&T`; no provenance forge.
18. `src/ptr/lib.rs:144` — `BackRef::from_raw` — caller contract; SAFE in audited use.
19. `src/ptr/lib.rs:178` — `BackRef::get_mut(&mut self)` — **T2 site**.
20. `src/ptr/lib.rs:559` — `ThisPtr::new` — debug null-check + ThisPtr is `Copy`, intentional dispatch pattern; SAFE.
21. `src/ptr/parent_ref.rs:49` — `LiveMarker` — debug-only; **T3 release-blind (§1.6)**.
22. `src/ptr/parent_ref.rs:188` — `ParentRef::anchored` — captures generation in debug; SAFE.
23. `src/ptr/parent_ref.rs:294` — `ParentRef::get` — debug assertion only; SAFE.
24. `src/ptr/parent_ref.rs:340` — `ParentRef::assume_mut` — consumes by value (not Copy via &mut); SAFE.

### Drop order at FFI boundaries (Part 2)

25. `src/spawn/process.rs:141` — `impl Drop for Process` — runs `poller.deinit()`; relies on default destructor ordering, **T3 doc/codegen hardening (§2.1)**.
26. `src/spawn/process.rs:575` — `Process::on_close_uv` — adopts +1 ref via ScopedRef, sets `poller = Detached`; SAFE.
27. `src/http_jsc/websocket_client.rs:1972` — `WebSocket::finalize` — `&mut *this_ptr` while `_guard` is live; SAFE under derive contract, **T3 derive-regression (§2.4)**.
28. `src/http_jsc/websocket_client.rs:2006` — `WebSocket::deinit` — runs at last ref; `Box::from_raw` order SAFE.
29. `src/runtime/webcore/fetch/FetchTasklet.rs:481` — `FetchTasklet::deinit` — `heap::take` then `clear_data`; SAFE.
30. `src/runtime/webcore/fetch/FetchTasklet.rs:374` — `deref_from_thread` — uses `release()` + `enqueue_concurrent` to bounce destruction to JS thread; SAFE.
31. `src/runtime/node/uv_signal_handle_windows.rs:49` — `free_with_default_allocator` — Box::take in uv_close cb; SAFE.
32. `src/jsc/VirtualMachine.rs:2998` — `free_ref_string` — RefString destroy callback; SAFE.
33. `src/runtime/api/bun/SSLContextCache.rs:250` — `bun_ssl_ctx_cache_on_free` — single allocation path; SAFE.
34. `src/runtime/napi/napi_body.rs:2435` — `napi_internal_enqueue_finalizer` — defers via task queue; SAFE.
35. `src/jsc/host_fn.rs:622` — `host_fn_finalize` — **T2 assumes mutator-thread sweep (§2.2)** + impl-Box::leak obligation (§5.2).

### Dyn Trait / Send (Part 3)

36. `src/spawn/lib.rs:202` — `Box<dyn SourceData>` implicit `'static`, **T3 future-Send hazard (§3.1)**.
37. `src/crash_handler/lib.rs:614` — `Box<dyn Fn(*mut c_void) + Send>` — correctly bounded; SAFE.
38. `src/install_types/resolver_hooks.rs:1616` — `Box<dyn Iterator + '_>` — correct lifetime tying; SAFE.
39. `src/resolver/package_json.rs:320` — same shape; SAFE.
40. `src/runtime/crypto/CryptoHasher.rs:796` — `Box<dyn Any>` — single-threaded use; SAFE.

### Async cancellation (Part 4)

41. `src/runtime/webcore/fetch/FetchTasklet.rs:1818` — `abort_listener` — re-entrant from C++; SAFE under JSC mutator-thread invariant.
42. `src/runtime/webcore/fetch/FetchTasklet.rs:1981` — `abort_task` — **T3 Relaxed cancellation flag policy (§4.1)**.
43. `src/http/Signals.rs:52` — `Signals::get` Relaxed read — paired with §4.1.
44. `src/runtime/server/NodeHTTPResponse.rs:1159` — `NodeHTTPResponse::abort` — flag flip + raw_response cleanup; SAFE on single thread.
45. `src/spawn/process.rs:657` — `Process::kill` — syscall, no state mutation; **T3 visible-state lag (§4.3)**.
46. `src/runtime/webcore/ReadableStream.rs:237` — `ReadableStream::cancel` — re-enters JSC; SAFE.
47. `src/runtime/webcore/ResumableSink.rs:407` — `ResumableSink::cancel` — flag + drain; SAFE.

### JSC GC finalizer (Part 5)

48. `src/jsc/JSCell.rs:118` — `JsCell<T>` declaration — **T2 unbounded Send/Sync contract defect (§6.2)**.
49. `src/jsc/Strong.rs:11` — `Strong` is `!Send` via NonNull; SAFE.
50. `src/jsc/web_worker.rs:611` — `unsafe impl Send for VirtualMachine` — load-bearing for `&'static VirtualMachine`; T3.
51. `src/jsc/web_worker.rs:586` — `SendPtr(*mut WebWorker)` local newtype with `Send`; SAFE under one-shot move discipline.
52. `src/codegen/generate-classes.ts:2901` (emitted code) — `host_fn::host_fn_finalize` template — **T2 missing leak-first wrap (§5.2)**.
53. `src/jsc/ipc.rs:454` — `json_ipc_data_string_free_cb` — simple bool flip; SAFE.
54. `src/io/posix_event_loop.rs:1446` — `process_deferred_frees_thunk` — drains a queue; SAFE.
55. `src/io/windows_event_loop.rs:358` — same shape; SAFE.

### Cross-crate Send composition (Part 6)

56. `src/ast/nodes.rs:39` — `StoreRef<T>: T: Send → Send` — correctly bounded; SAFE.
57. `src/ast/nodes.rs:339` — `StoreSlice<T>` — **T1 unbounded (§6.3)**.
58. `src/bundler/BundleThread.rs:173` — `SendPtr<T>` local launder; documented; SAFE.
59. `src/runtime/dns_jsc/dns.rs:107` — `SendPtr<T>` — same.
60. `src/bun_core/atomic_cell.rs:66` — `AtomicCell<T>: T: Copy → Sync` — correctly bounded; SAFE.
61. `src/bun_core/util.rs:2283` — `RacyCell<T>: T: ?Sized + Send → Send` — bounded; SAFE.
62. `src/threading/channel.rs:47` — `Channel<T, B>: T: Send → Send` — bounded; SAFE.
63. `src/threading/RwLock.rs:158` — `RwLock<T>: T: Send + Sync → Sync` — bounded; SAFE.
64. `src/jsc/webcore_types.rs:95` — `unsafe impl Send for Blob` over `Cell<*const T>` — **T2 (§6.4)**.
65. `src/jsc/webcore_types.rs:1200` — `unsafe impl Send for StoreRef` — already covered by Pass-2.
66. `src/install/PackageInstall.rs:735` — `pending_tasks.fetch_sub(1, Release)` — **T3 mixed ordering policy (§1.4)**.
67. `src/install/PackageManager/runTasks.rs:1592` — `pending_tasks.fetch_add(count, Relaxed)` — same.
68. `src/install/PackageManager/runTasks.rs:1597` — `fetch_sub(1, Release)` — same.
69. `src/install/PackageManager/runTasks.rs:1583` — `load(Acquire)` — same.
70. `src/jsc/event_loop.rs:943` — `concurrent_ref.fetch_add(1, SeqCst)` — over-strict; **T3 perf**.
71. `src/jsc/event_loop.rs:949` — `concurrent_ref.fetch_sub(1, SeqCst)` — over-strict; T3.
72. `src/jsc/web_worker.rs:276` — `OUTSTANDING.fetch_add(1, Release)` — paired with Acquire reads (line 332, 377); SAFE.
73. `src/jsc/web_worker.rs:309` — `OUTSTANDING.fetch_sub(1, Release)` — paired; SAFE.
74. `src/http/AsyncHTTP.rs:867` — `ACTIVE_REQUESTS_COUNT.fetch_sub(1, Relaxed)` — metric counter; SAFE.
75. `src/http/AsyncHTTP.rs:913` — `fetch_add(1, Relaxed)` — same; SAFE.
76. `src/crash_handler/lib.rs:895` — `PANICKING.fetch_add(1, SeqCst)` — crash path, over-strict acceptable; SAFE.
77. `src/runtime/api/glob.rs:409` — `has_pending_activity.fetch_sub(1, SeqCst)` — paired with same-strict reads; SAFE but over-strict.

---

## Bug findings — consolidated by tier

### T1 (confirmed patchable — 1)

| # | Title | Site | Fix sketch |
| --- | --- | --- | --- |
| T1-1 | `unsafe impl<T> Send/Sync for StoreSlice<T>` unsound for `T: !Send`/`T: !Sync` | `src/ast/nodes.rs:339-340` | Add `T: Send`/`T: Sync` bounds (matches sibling `StoreRef<T>`). |

### T2 (unsafe-contract / architecture defect — 8)

| # | Title | Site | Fix sketch |
| --- | --- | --- | --- |
| T2-1 | `ThreadSafeRefCount::ref_` needs a checked raw-pointer upgrade path | `src/ptr/ref_count.rs:469` | Add `try_ref` with CAS-loop; use it at raw-pointer handoff sites that cannot prove an existing live ref. |
| T2-2 | `WeakPtrData` is plain `u32` if weak refs ever cross threads | `src/ptr/weak_ptr.rs:9` | Replace `u32` storage with `AtomicU32` or document/enforce single-thread use at the type level. |
| T2-3 | `unsafe impl<T> Send/Sync for JsCell<T>` is broader than the JS-thread discipline | `src/jsc/JSCell.rs:126, 128` | Prefer `T: Send`/`T: Sync` bounds plus explicit JS-thread-only wrappers for exceptions. |
| T2-4 | `Blob: Send + Sync` over `Cell<...>` fields | `src/jsc/webcore_types.rs:95-96` | Split JS-thread state from worker-shareable snapshot/mutex state. |
| T2-5 | Two divergent atomic-ordering policies (`SeqCst` vs `Release+Acquire-fence`) for refcount | `src/ptr/ref_count.rs:474, 492, 527` vs `src/ptr/raw_ref_count.rs:86, 92, 105` | Harmonize or document why the stricter primitive needs SeqCst. |
| T2-6 | `BackRef::get_mut` lies about exclusivity (Copy + `&mut self`) | `src/ptr/lib.rs:178` | Remove `get_mut` or make the wrapper non-`Copy` for mutating projections. |
| T2-7 | `host_fn_finalize` codegen doesn't wrap with `finalize_js_box` for intrusively-refcounted T | `src/codegen/generate-classes.ts:2901` + `src/jsc/host_fn.rs:622` | Codegen a leak-first helper for refcounted host classes. |
| T2-8 | 157 unique `unsafe impl Send/Sync` sites lack consistent invariant tags | inventory: `categories has send_impl/sync_impl` | Add `SAFETY-AFFINITY:` tags and a CI grep. |

### T3 (latent watchlist / policy cleanup — 12)

| # | Title | Site |
| --- | --- | --- |
| T3-1 | `concurrent_ref` / `OUTSTANDING` SeqCst over-strict | `src/jsc/event_loop.rs:943, 949` |
| T3-2 | `Source::Any(Box<dyn SourceData>)` implicit `'static` + no Send bound | `src/spawn/lib.rs:202` |
| T3-3 | `WebSocket::finalize` `&mut *this_ptr` while ScopedRef is live — derive-regression hazard | `src/http_jsc/websocket_client.rs:1972` |
| T3-4 | `Process::kill` does not transition state observably before exit cb | `src/spawn/process.rs:657` |
| T3-5 | `RefPtr` has no `Drop` impl — silent leaks on `Option::take` etc. | `src/ptr/ref_count.rs:790` (declaration) |
| T3-6 | `abort_listener` depends on C++ side's remove-before-emit ordering | `src/runtime/webcore/fetch/FetchTasklet.rs:1818` |
| T3-7 | `pending_tasks` mixed `Relaxed`/`Release`/`Acquire` orderings need a written policy | `src/install/PackageInstall.rs`; `src/install/PackageManager/runTasks.rs` |
| T3-8 | `FetchTasklet::abort_task` Relaxed cancellation flag should document whether stale reads are acceptable | `src/runtime/webcore/fetch/FetchTasklet.rs:1982` |
| T3-9 | `unsafe impl Sync/Send for VirtualMachine` (intentional, but JS-thread affinity is review-enforced) | `src/jsc/VirtualMachine.rs:611–612` |
| T3-10 | `ParentRef::debug_assert_live` reads through a dangling raw pointer if the parent allocation was freed | `src/ptr/parent_ref.rs:270` |
| T3-11 | `LiveMarker` is debug-only; release builds have no use-after-parent-drop signal | `src/ptr/parent_ref.rs:49` |
| T3-12 | `Process::Drop` ordering depends on default `destructor` (`Box::from_raw`) | `src/spawn/process.rs:141` |

---

## Hardened patterns / recommended fixes

### Pattern A: Refcount ordering harmonisation

The `ThreadSafeRefCount` primitive can be reshaped to match the
`RawAtomicRefCount` ordering with **zero ABI change**:

```rust
// src/ptr/ref_count.rs:469
pub unsafe fn ref_(self_: *mut T) {
    let count = unsafe { &*T::get_ref_count(self_) };
    #[cfg(debug_assertions)]
    count.debug.assert_valid();
    let old_count = count.raw_count.fetch_add(1, Ordering::Relaxed);  // was SeqCst
    debug_assert!(old_count > 0);
}

// src/ptr/ref_count.rs:487
pub unsafe fn deref(self_: *mut T) {
    let count = unsafe { &*T::get_ref_count(self_) };
    #[cfg(debug_assertions)]
    count.debug.assert_valid();
    let old_count = count.raw_count.fetch_sub(1, Ordering::Release);  // was SeqCst
    debug_assert!(old_count > 0);
    if old_count == 1 {
        core::sync::atomic::fence(Ordering::Acquire);                 // NEW
        #[cfg(debug_assertions)]
        unsafe { (*T::get_ref_count(self_)).debug.deinit(return_address()) };
        unsafe { T::destructor(self_) };
    }
}
```

### Pattern B: Refcount revival guard

```rust
// New API in src/ptr/ref_count.rs near line 469
/// Try to bump the refcount; fails if the count is zero (i.e. the object is
/// already being destroyed). Use this only when you hold a raw `*mut T`
/// across a thread boundary and cannot statically prove a live ref.
///
/// # Safety
/// `self_` must point to memory that is at least guaranteed to be the
/// `ThreadSafeRefCount` field of a possibly-already-destroyed allocation.
/// Surviving a `false` return requires the surrounding code to abandon
/// `self_` without further dereference.
pub unsafe fn try_ref(self_: *mut T) -> bool {
    let count = unsafe { &*T::get_ref_count(self_) };
    let mut cur = count.raw_count.load(Ordering::Relaxed);
    loop {
        if cur == 0 { return false; }
        match count.raw_count.compare_exchange_weak(
            cur, cur + 1, Ordering::Relaxed, Ordering::Relaxed,
        ) {
            Ok(_) => return true,
            Err(actual) => cur = actual,
        }
    }
}
```

### Pattern C: Marker trait `JsThreadOnly` for cross-thread refusal

```rust
// src/jsc/lib.rs
/// ZST marker — any struct that holds a `JsThreadOnly` field is `!Send`/`!Sync`
/// by composition (because `*const ()` is `!Send`/`!Sync`).
#[repr(transparent)]
pub struct JsThreadOnly(core::marker::PhantomData<*const ()>);

impl JsThreadOnly {
    pub const NEW: Self = Self(core::marker::PhantomData);
}

// bun_jsc::Strong gains a field:
pub struct Strong {
    handle: NonNull<Impl>,
    _affinity: JsThreadOnly,
}
```

Today `Strong` is already `!Send`/`!Sync` via the `NonNull<Impl>` inference,
but the marker makes the *reason* visible to readers and survives future
refactors that might wrap `NonNull` in a `repr(transparent)` newtype that
restores auto-traits.

### Pattern D: `unsafe impl<T> Send` registry annotation

```rust
// SAFETY-AFFINITY: js-thread-only — type lives in VirtualMachine fields;
// all accesses go through `bun_vm()` which asserts thread match.
unsafe impl<T: Send> Sync for JsCell<T> {}
unsafe impl<T: Send> Send for JsCell<T> {}
```

The `SAFETY-AFFINITY:` tag is grepable. A `tools/audit-send-sync.sh` script
that finds all `unsafe impl (Send|Sync)` lines without the tag fails CI.

### Pattern E: `finalize_js_box` codegen wrap

`src/codegen/generate-classes.ts:2901` becomes:

```ts
templ += `host_fn::host_fn_finalize(this, |b| bun_ptr::finalize_js_box(b, |t| ${T}::finalize(t)))`;
```

for any class declared `intrusive_refcount: true`. The signature change
surfaces every miss at compile time.

---

## Recommended PRs

### PR-1 (medium priority, mechanical performance/consistency)

**Title:** `ptr: harmonise ThreadSafeRefCount ordering with std::sync::Arc`

**Files:** `src/ptr/ref_count.rs` (lines 469, 487, 522).

**Change:** Pattern A above. Switch `fetch_add(1, SeqCst)` → `Relaxed` on
ref; `fetch_sub(1, SeqCst)` → `Release` on deref/release; add
`fence(Acquire)` before destructor. No ABI change. No semantic change for
correct callers.

**Risk:** Low if the audited invariant is correct. The new ordering is less
constrained than SeqCst but follows the standard intrusive-refcount pattern:
Release on decrement and Acquire before destructor visibility. This is not a
soundness emergency; it is a consistency/performance cleanup.

**Tests:** `bun bd test test/js/web/fetch/fetch.test.ts` exercises every
intrusive refcount type in the hot path; a fresh round of TSAN-instrumented
runs would also surface any regression.

### PR-2 (medium priority, surgical hardening)

**Title:** `ptr: make WeakPtrData atomic`

**Files:** `src/ptr/weak_ptr.rs`.

**Change:** `WeakPtrData(u32)` → `WeakPtrData(AtomicU32)`. Convert
`set_reference_count`/`set_finalized`/`on_finalize` to CAS loops over the
combined 32-bit value (the FINALIZED_BIT/REF_MASK split survives unchanged).

**Risk:** Low. The Zig original was single-threaded by construction; the
Rust port appears to be too in sampled uses, but the type system doesn't
enforce it. Going atomic costs a single `lock cmpxchg` per ref/deref. If
performance matters, first prove all users are JS-thread-only and encode that
with a thread-affinity marker instead.

### PR-3 (high priority for StoreSlice, medium for JsCell)

**Title:** `ast,jsc: tighten unbounded unsafe impl<T> Send/Sync impls`

**Files:** `src/ast/nodes.rs:339-340` (`StoreSlice<T>`), `src/jsc/JSCell.rs:126-128` (`JsCell<T>`).

**Change:** Add `T: Send`/`T: Sync` bounds to `StoreSlice<T>` immediately.
For `JsCell<T>`, first run a compile-check branch with the same bounds and
decide whether each error is a true bug or an intentional JS-thread-only
exception that needs a narrower wrapper.

**Risk:** Medium. Will surface any latent unsoundness as a compile error.
Each error site is a separate audit; either the bound is correct (and the
site was an underlying bug) or the site genuinely needs a SAFETY-AFFINITY
narrowing.

### PR-4 (low/medium priority, policy cleanup)

**Title:** `install: pick a single ordering policy for pending_tasks`

**Files:** `src/install/PackageInstall.rs:735, 2098`; `src/install/PackageManager/runTasks.rs:1583, 1592, 1597`.

**Change:** All five sites → `Relaxed` (the mutex protects the queue, so the
counter is a metric). Document the choice in `PackageManager`.

**Risk:** Low if `pending_tasks` is only a metric/completion counter. This is
not a proven race; the PR should first document that no payload publication
rides on the counter.

### PR-5 (medium priority, codegen)

**Title:** `codegen: wrap intrusively-refcounted finalizers in finalize_js_box`

**Files:** `src/codegen/generate-classes.ts:2893-2902`, plus any
`.classes.ts` files that need an `intrusive_refcount: true` annotation.

**Change:** Pattern E above. Mechanical for every `.classes.ts` whose Rust
impl uses `bun_ptr::ThreadSafeRefCounted` or `CellRefCounted`.

**Risk:** Low-medium. Each class needs a one-line annotation in its
`.classes.ts`. The codegen change is a single line.

### PR-6 (medium priority, marker)

**Title:** `jsc: add JsThreadOnly marker to Strong/JsCell/JSGlobalObject`

**Files:** `src/jsc/lib.rs` (new marker), `src/jsc/Strong.rs:11`, `src/jsc/JSCell.rs:119`.

**Change:** Pattern C above. Adds a `PhantomData<*const ()>` field to each
JS-thread-bound primitive. The auto-trait inference does the rest — no more
`unsafe impl Send/Sync` blocks needed for these.

**Risk:** Medium. Will surface as compile errors anywhere these were
previously sent across threads. Each is a real bug or a real
`SAFETY-AFFINITY: cross-thread-handoff-via-X` site.

### PR-7 (lower priority, observability)

**Title:** `ptr: release-build defense-in-depth for ParentRef`

**Files:** `src/ptr/parent_ref.rs:49`.

**Change:** Add a single-bit `alive` field that survives in release builds.
`ParentRef::get()` panics (with `bun_core::panic!`) instead of silently
dereferencing a freed allocation.

**Risk:** Low. Adds one byte of overhead per `LiveMarker` in release. Worth
it for the diagnostic.

### PR-8 (lower priority, refactor)

**Title:** `webcore: split Blob into BlobOnJsThread / BlobOnWorker`

**Files:** `src/jsc/webcore_types.rs:80-100`, plus every consumer.

**Change:** Pattern §6.4. Split `Blob` so the `global_this: Cell<*const
JSGlobalObject>` only exists on the JS-thread variant.

**Risk:** High. Large refactor touching `ObjectURLRegistry`, the work-pool
read/write paths, `Bun.file()`, etc. Track as a follow-up.

---

## Cross-cutting observations

1. **The Rust port consistently substitutes `unsafe impl Send/Sync` for the
   missing Zig auto-trait machinery.** Zig has no Send/Sync; the port
   needs Send for `'static`-bound trait objects and for cross-thread work
   queues. In ~85% of the audited sites the impl is sound (correctly bounded
   on T or correctly tied to a thread-affinity invariant). The ~15%
   problematic sites are concentrated in the **unbounded `<T>` generic**
   pattern. `StoreSlice<T>` is a confirmed small fix; `JsCell<T>` and `Blob`
   need a narrower JS-thread-affinity design rather than a blind bounds edit.
2. **The atomic-ordering story is bifurcated.** `bun_ptr::RawAtomicRefCount`
   uses canonical Arc ordering. `bun_ptr::ThreadSafeRefCount` uses SeqCst
   everywhere. There is no documented reason for the divergence; the most
   likely explanation is that `RawAtomicRefCount` was written by someone
   familiar with Arc and `ThreadSafeRefCount` was written defensively. The
   T2-1 finding (§1.1) is the only architectural issue here; the fix is
   mechanical.
3. **JSC GC finalizer aliasing is the single most concentrated UB hazard.**
   Every `extern "C" fn` finalizer that consumes worker-thread-allocated
   state is a potential cross-thread Drop hazard. The CLAUDE.md guidance
   plus the `bun_ptr::finalize_js_box` helper are the right mitigations;
   they are not consistently applied (T2-4 §5.2).
4. **Async cancellation paths are uniformly well-shaped.** The Pass-2
   pattern of "use `release()` + `enqueue_concurrent` to bounce destruction
   to the JS thread" is applied consistently to `FetchTasklet`, `Process`,
   `WebSocket`, and the libuv close paths. The only finding here is the
   `Relaxed` ordering on the `aborted` flag, which is not a proven race in
   this pass but is worth documenting or strengthening if future code uses it
   as a publication edge.
5. **Cross-crate Send composition holds where each crate uses bounded
   `unsafe impl<T: Send>`.** The two crates that break composition
   (`bun_ast::StoreSlice`) is mechanically fixable. `bun_jsc::JsCell` is a
   real unsafe-contract defect, but the fix likely needs a JS-thread-only
   marker/newtype rather than only adding generic bounds.

---

## Appendix: tooling

This audit was driven by:

- `.unsafe-audit/unsafe-inventory.jsonl` — 11044 sites
  categorised by `categories: ["send_impl", "atomic", "pin_unchecked", …]`.
- `jq -r '. | select(.categories | index("send_impl"))' …` — extracting
  Send/Sync impls.
- `grep -rn "fetch_(add|sub)\(1, Ordering::"` — atomic ordering survey.
- `grep -rn "unsafe impl<T> Send"` — unbounded generic Send impls.
- Manual reading of `src/ptr/ref_count.rs`, `weak_ptr.rs`, `raw_ref_count.rs`,
  `parent_ref.rs`, `lib.rs`; `src/spawn/process.rs`,
  `src/runtime/webcore/fetch/FetchTasklet.rs`,
  `src/http_jsc/websocket_client.rs`, `src/jsc/JSCell.rs`,
  `src/jsc/Strong.rs`, `src/jsc/host_fn.rs`.

End of PASS3-cross-cutting-races-drops-async.md.
