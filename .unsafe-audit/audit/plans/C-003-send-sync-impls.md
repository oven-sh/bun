# C-003 — `unsafe impl Send` / `Sync` / Other Unsafe Trait Impls

**Cluster:** Send/Sync auto-trait assertions and other `unsafe impl Trait for T {}`
sites. Spans 22 crates of the Bun Rust workspace.

## Codex pass 2 amendment

Do **not** assume `static_assertions` is already available.

Searches across `Cargo.toml`, `Cargo.lock`, and `src/**/*.rs` found no current
`static_assertions` dependency or `assert_impl_all!` usage. Bun does already use
a zero-dependency auto-trait proof pattern in
`src/runtime/shell/subproc.rs:75-97`; prefer that style unless maintainers
explicitly approve adding an assertion crate.

## Executive Summary

The Send/Sync surface is **the single highest-leverage refactor cluster in the
audit.** Across the workspace there are **157 manual `Send`/`Sync` assertions**
(87 `Send`, 70 `Sync`, with an 8-impl overlap of joint `Send+Sync` blocks) and
an additional **188 `unsafe impl Trait`** sites for traits other than Send/Sync
(`Allocator`, `Pod`, `Zeroable`, `UvHandle`, `Linked`, …). Of the 157 Send/Sync
impls, **45 are *generic* propagating impls** of the form
`unsafe impl<T: Bound> Send for Wrapper<T>` — exactly the shape that almost
always indicates a missing structural derive, and the shape the cluster's
refactor is built around.

Breakdown after per-site source inspection:

| Subclass                                       | Count | Refactor effort | Outcome                                                 |
| ---------------------------------------------- | -----:| --------------- | ------------------------------------------------------- |
| **C-PROPAGATE** — generic, structurally sound  | **28**| Low–Medium      | Replace `*mut/*const T` with `NonNull<T>` + `PhantomData<T>`; remove `unsafe impl` entirely. |
| **C-USE-ASSERTIONS** — already-auto-derived    | **9** | Low             | Drop the manual impl and add a compile-time auto-trait assertion. Use Bun's no-dependency trait trick unless an assertion crate is explicitly accepted. |
| **C-REMOVE-IMPL** — type does not cross threads| **3** | Low             | Verify call sites; delete the impl. |
| **C-CONSOLIDATE** — duplicated `SendPtr` newtypes | **6** | Low          | Lift into a shared `bun_ptr::SendPtr<T>` / `bun_ptr::SyncWrapper<T>`. |
| **A-RAW-PTR-TO-C-STATE** — opaque C handle     | **38**| —               | Manual impl required; document the C library's threadsafety guarantee. |
| **A-CUSTOM-INVARIANT** — load-bearing lie      | **73**| —               | Manual impl is the design; auto-derive cannot express the invariant. |

**Total `(C)` refactorable sites: 46** out of 157 — a 29% reduction in
hand-asserted Send/Sync surface, removing 46 `unsafe impl` lines from the
codebase entirely.

### Soundness finding (separate from refactor)

`bun_ast::StoreSlice<T>` (`src/ast/nodes.rs:339-340`) declares
`unsafe impl<T> Send` / `unsafe impl<T> Sync` *without* a `T: Send`/`T: Sync`
bound — but its sister type `StoreRef<T>` on the same module (lines 39-40) is
correctly bounded `unsafe impl<T: Send> Send`. The unbounded variant launders
`!Send`/`!Sync` `T`s. Concretely, a `StoreSlice<core::cell::Cell<u32>>` can be
moved or borrowed across threads and its `.slice() -> &[Cell<u32>]` can then be
read concurrently — an unsound API surface. **Fix:** match `StoreRef`'s
bounds:
`unsafe impl<T: Send> Send for StoreSlice<T>` and
`unsafe impl<T: Sync> Sync for StoreSlice<T>`. Counted under C-PROPAGATE.

---

## Per-Crate Distribution

### Send/Sync impls (manual) — 157 total

| Crate                  | Total | Generic (propagating) | Concentrated in                                |
| ---------------------- | -----:| --------------------:| ---------------------------------------------- |
| `bun_bundler`          |    23 |                    6 | `LinkerContext`, `LinkerGraph`, `Chunk`, `ThreadPool`, `BundleThread` |
| `bun_core`             |    18 |                   10 | `atomic_cell.rs` (AtomicCell, ThreadCell), `util.rs` (RacyCell, Once), `lib.rs` (RawSlice), `string/*` |
| `bun_jsc`              |    18 |                    4 | `VirtualMachine`, `JsCell`, `WorkTask`, `ConcurrentPromiseTask`, `Debugger`, `web_worker` |
| `bun_runtime`          |    18 |                    1 | `fs_events`, `path_watcher`, `dns_jsc`, `shell/*`, `napi`, `bake` |
| `bun_threading`        |    16 |                    5 | `RwLock`, `Channel`, `GuardedBy`, `Mutex`, `Condition`, `Semaphore`, `ThreadPool` |
| `bun_alloc`            |    10 |                    2 | `MimallocArena`, `MaxHeapAllocator`, `BSSList`, `Zone`, `StdAllocator` |
| `bun_ast`              |     6 |                    4 | `StoreRef`, `StoreSlice`, `StoreStr` |
| `bun_resolver`         |     6 |                    0 | `fs.rs` (EntriesOption, Entry), `lib.rs` (EntriesOption alias) |
| `bun_collections`      |     5 |                    4 | `StringHashMapKey`, `MultiArrayList`, `DynamicBitSetList` |
| `bun_http`             |     5 |                    0 | `SSLConfig`, `HpackHandle`, `InitOpts`, `Resolved` |
| `bun_css`              |     4 |                    4 | `DeclarationBlock`, `CssRule` |
| `bun_js_parser`        |     4 |                    0 | `DefineData`, `SyncDefineData` |
| `bun_ptr`              |     4 |                    4 | `BackRef`, `ParentRef` |
| `bun_semver`           |     4 |                    0 | `List`, `Group` |
| `bun_sys`              |     4 |                    0 | `Name`, `DynLib` |
| `bun_standalone_graph` |     3 |                    0 | `Instance`, `StandaloneModuleGraph` |
| `bun_boringssl`        |     2 |                    0 | `CtxStore` |
| `bun_io`               |     2 |                    0 | `Waker` |
| (other 5 crates)       |     5 |                    1 | one-offs |

### `unsafe impl Trait` (non-Send/Sync) — 188 total

| Trait                              | Count | Refactor potential                                                    |
| ---------------------------------- | -----:| --------------------------------------------------------------------- |
| `bytemuck::Zeroable`               |    89 | **(A)** — trait is `unsafe`; required for the FFI/POD safety contract. Many sites can switch to `#[derive(Zeroable)]` (bytemuck-derive) once feature-gated, which removes the `unsafe` line while preserving the bound. ~40 candidates. |
| `bun_libuv_sys::UvHandle`          |    16 | **(A)** — uv handle marker trait. Mechanical; one site per handle type. |
| `bun_collections::intrusive::Linked` | 14 | **(A)** — intrusive linked-list link projection; `unsafe fn link(item: *mut Self) -> *const Link<Self>` body is genuinely unsafe (raw ptr field offset). |
| `bun_core::AssertNoUninitializedPadding` | 12 | **(A)** — bun-internal "no padding bytes" assertion for FFI structs. Could be derive-macroized; small win. |
| `bun_libuv_sys::UvReq`             |    10 | **(A)** — uv request marker trait. |
| `bytemuck::Pod`                    |     9 | **(A)** — derive-macro candidates (8/9). |
| `bytemuck::NoUninit`               |     8 | **(A)** — derive-macro candidates. |
| `Allocator` (std)                  |     7 | **(A)** — `Allocator` is `unsafe trait` in the standard library; impl body is genuinely unsafe. |
| `bun_jsc::LaunderedSelf`           |     5 | **(A)** — provenance laundering for re-entrant callbacks; intentional. |
| `wtf::ExternalSharedDescriptor`    |     5 | **(A)** — WTF string descriptor contract. |
| `bun_libuv_sys::UvStream`          |     4 | **(A)** — uv stream marker trait. |
| `wtf::Atom`                        |     3 | **(A)** — atom interning contract. |
| `bun_jsc::OpaqueHandle`            |     2 | **(A)** — opaque FFI handle marker. |
| `bytemuck::TransparentWrapper`     |     1 | **(A)** — derive candidate. |
| `bun_threading::OwnedTask`         |     1 | **(A)** — work-pool task ownership contract. |
| `bun_collections::intrusive::Node` |     1 | **(A)** — intrusive node marker. |
| `std::alloc::GlobalAlloc`          |     1 | **(A)** — `unsafe trait`. |

**Total `other_unsafe_impl` (C)-style wins:** ~60 sites under `Zeroable` / `Pod`
/ `NoUninit` / `TransparentWrapper` / `AssertNoUninitializedPadding` could
become `#[derive(...)]` lines (bytemuck-derive already in Cargo.lock for parts
of the workspace; this is a single-PR change per crate). The actual unsafety
contract is unchanged; only the line of `unsafe impl` syntax is removed. The
remaining ~128 sites are all genuine `unsafe trait` implementations and stay.

---

## The Refactor Patterns

### Pattern 1: `*mut T` → `NonNull<T>` + `PhantomData<T>`

**When it applies:** the struct holds a raw `*mut T` / `*const T` field with no
ownership-style interior mutability (no `UnsafeCell<T>`, no `Cell<T>`,
no `Atomic*`). The `Send`/`Sync` claim follows from the pointee — exactly the
shape `NonNull<T>` already encodes.

The auto-derive rules for `NonNull<T>`:

| Type                | `Send`         | `Sync`         |
| ------------------- | -------------- | -------------- |
| `*mut T`            | never (manual) | never (manual) |
| `*const T`          | never (manual) | never (manual) |
| `NonNull<T>`        | never (manual) | never (manual) |
| `PhantomData<T>`    | `T: Send`      | `T: Sync`      |
| `PhantomData<&'a T>`| `T: Sync`      | `T: Sync`      |
| `PhantomData<&'a mut T>` | `T: Send` | `T: Sync`      |

So `NonNull<T>` alone does **not** restore the auto-traits; the idiom is
`NonNull<T> + PhantomData<T>` for owning semantics, or
`NonNull<T> + PhantomData<&'a T>` for shared-borrow semantics. Then the struct
auto-derives the right bound — `unsafe impl` disappears.

**Before** (`src/runtime/dns_jsc/dns.rs:104-107`):

```rust
/// Send-wrapper for raw pointers handed to the threaded work pool.
#[repr(transparent)]
struct SendPtr<T>(*mut T);
// SAFETY: see type doc — synchronization is provided by `global_cache()`.
unsafe impl<T> Send for SendPtr<T> {}
```

This is doubly broken:
1. The `<T>` bound is missing — `SendPtr<Cell<u32>>` would silently be `Send`
   even though `Cell<u32>: !Send`.
2. The manual `unsafe impl` line exists at all.

**After:**

```rust
#[repr(transparent)]
struct SendPtr<T> {
    ptr: core::ptr::NonNull<T>,
    _marker: core::marker::PhantomData<T>,
}
// No `unsafe impl Send` — auto-derived as `T: Send`.
```

The `repr(transparent)` is preserved because `NonNull<T>` is itself
`repr(transparent)` and `PhantomData<T>` is a ZST. The `*mut T → NonNull<T>`
change means callers must `NonNull::new(p).unwrap()` (or `new_unchecked`) at
construction sites; in every case here the pointer is already known non-null
(it's a `Box::into_raw` result).

### Pattern 2: compile-time auto-trait assertions

**When it applies:** the struct has *no* raw pointers, *no* `UnsafeCell`, and
no `&'a UnsafeReason`. The manual `unsafe impl` exists either as a holdover
from an earlier shape, or as belt-and-suspenders alongside fields that already
auto-derive Send/Sync. In these cases the `unsafe impl` is silently a no-op:
the type would auto-derive anyway. Replacing it with a positive *assertion*
both removes the `unsafe` line and gives a build-time regression catch the day
someone adds a `!Send` field.

**Before:**

```rust
pub struct GenerateChunkCtx<'a> {
    pub c: bun_ptr::ParentRef<LinkerContext<'a>>,
    pub chunks: bun_ptr::BackRef<[Chunk]>,
    pub chunk: bun_ptr::BackRef<Chunk>,
}
unsafe impl<'a> Send for GenerateChunkCtx<'a> {}
unsafe impl<'a> Sync for GenerateChunkCtx<'a> {}
```

If `ParentRef` and `BackRef` are already correctly Send/Sync-propagating
(they are: `unsafe impl<T: Sync> Send for BackRef<T>` etc.), then
`GenerateChunkCtx<'a>` auto-derives Send/Sync the moment all three
constituent types do — the manual impls add nothing.

**After:**

```rust
pub struct GenerateChunkCtx<'a> {
    pub c: bun_ptr::ParentRef<LinkerContext<'a>>,
    pub chunks: bun_ptr::BackRef<[Chunk]>,
    pub chunk: bun_ptr::BackRef<Chunk>,
}
// Lock in the auto-derive — use Bun's existing no-dependency assertion
// pattern (see runtime/shell/subproc.rs), or explicitly add an assertion
// crate if maintainers prefer macro-based checks.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<GenerateChunkCtx<'static>>();
};
```

The assertion is a pure win when the type truly auto-derives: zero runtime
cost, zero binary size delta, one fewer `unsafe impl`, plus guaranteed
regression detection. The exact assertion spelling should follow Bun-local
style; do not assume `static_assertions` is available.

### Pattern 3: `bun_ptr::SendPtr<T>` — consolidate the three duplicates

The codebase has three independently-defined `SendPtr` newtypes:

| Site                                          | Form |
| --------------------------------------------- | --------------------------- |
| `src/bundler/BundleThread.rs:170-173`         | `<T>(*mut T)` generic       |
| `src/runtime/dns_jsc/dns.rs:104-107`          | `<T>(*mut T)` generic       |
| `src/jsc/web_worker.rs:586-590`               | `(*mut WebWorker)` concrete |
| `src/jsc/Debugger.rs:590-593` (`SendVmPtr`)   | `(*mut VirtualMachine)` concrete |

All four serve the same purpose: "ship a raw pointer across the
`std::thread::spawn` boundary, the receiving thread is the sole user." The
right home is `bun_ptr` (which already owns the `BackRef`/`ParentRef`/`ThisPtr`
family). Add:

```rust
// In src/ptr/lib.rs, alongside BackRef / ParentRef.

/// Single-owner cross-thread raw-pointer carrier. Use when one thread spawns
/// another and hands it a pointer it then owns exclusively (e.g.
/// `std::thread::spawn` callbacks). The receiving thread does *not* share —
/// `Sync` is intentionally not implemented.
#[repr(transparent)]
pub struct SendPtr<T: ?Sized> {
    ptr: core::ptr::NonNull<T>,
    _marker: core::marker::PhantomData<T>,
}

// Send-iff-T-Send via PhantomData<T>; Sync is auto-suppressed by NonNull.
// (No manual `unsafe impl`.)

impl<T: ?Sized> SendPtr<T> {
    #[inline]
    pub fn new(ptr: core::ptr::NonNull<T>) -> Self {
        Self { ptr, _marker: core::marker::PhantomData }
    }
    #[inline]
    pub fn as_ptr(self) -> *mut T { self.ptr.as_ptr() }
}
```

This deletes 4 ad-hoc `unsafe impl<T> Send`s and gives every future "spawn a
thread with a pointer" site a vetted, audited primitive.

---

## Representative Sites (20)

Each row identifies a real site; "subclass" is the proposed disposition. Sites
are listed by file:line — paths are absolute from the workspace root.

| ID         | Crate            | File:Line                                            | Struct                       | Current                                                                | Subclass        |
| ---------- | ---------------- | ---------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- | --------------- |
| S-000484   | bun_bundler      | `src/bundler/BundleThread.rs:170-173`                | `SendPtr<T>`                 | `<T> Send` on `(*mut T)`                                               | C-CONSOLIDATE   |
| S-003894   | bun_jsc          | `src/jsc/web_worker.rs:586-590`                      | `SendPtr`                    | unconditional `Send` on `(*mut WebWorker)`                             | C-CONSOLIDATE   |
| S-003398   | bun_jsc          | `src/jsc/Debugger.rs:590-593`                        | `SendVmPtr`                  | unconditional `Send` on `(*mut VirtualMachine)`                        | C-CONSOLIDATE   |
| S-006258   | bun_runtime      | `src/runtime/dns_jsc/dns.rs:104-107`                 | `SendPtr<T>`                 | `<T> Send` on `(*mut T)`, **bound missing — latent bug**               | C-CONSOLIDATE / C-PROPAGATE bug |
| S-000292/3 | bun_ast          | `src/ast/nodes.rs:339-340`                           | `StoreSlice<T>`              | `<T> Send`, `<T> Sync` unconditional — **soundness bug**               | C-PROPAGATE (bug fix) |
| S-000284/5 | bun_ast          | `src/ast/nodes.rs:39-40`                             | `StoreRef<T>`                | `<T: Send> Send`, `<T: Sync> Sync` (correct shape — keep) over `NonNull<T>` | C-USE-ASSERTIONS |
| S-001236/7 | bun_core         | `src/bun_core/lib.rs:211-212`                        | `RawSlice<T>`                | `<T: Sync> Send`, `<T: Sync> Sync` over `*const [T]`                   | C-PROPAGATE     |
| S-000965/6 | bun_collections  | `src/collections/array_hash_map.rs:1558-1559`        | `StringHashMapKey<A>`        | `<A: Allocator + Default + Send> Send` over `NonNull<u8>` + `PhantomData<Box<[u8], A>>` | C-USE-ASSERTIONS (PhantomData already present; verify the `Box<[u8], A>` PhantomData makes auto-derive fire) |
| S-001037/8 | bun_collections  | `src/collections/multi_array_list.rs:443-453`        | `MultiArrayList<T, A>`       | `<T: Send, A: Allocator + Send> Send` over `bytes: *mut u8 + PhantomData<T>` | C-PROPAGATE (medium) — replace `*mut u8` with `NonNull<u8>` + `PhantomData<(T, A)>` |
| S-001726/7 | bun_css          | `src/css/rules/mod.rs:173-174`                       | `CssRule<R>`                 | `<R: Send> Send` (blocked by `ArenaVec` raw `NonNull<T>` + `&Bump`)    | C-PROPAGATE (blocked on leaf fix) |
| S-004494/5 | bun_ptr          | `src/ptr/lib.rs:627-628`                             | `BackRef<T>`                 | `<T: ?Sized + Sync> Send`, `<T: ?Sized + Sync> Sync` (correct, keep)   | A-CUSTOM-INVARIANT (kept — the `assume_mut` escape hatch is the documented invariant) |
| S-004505/6 | bun_ptr          | `src/ptr/parent_ref.rs:406-407`                      | `ParentRef<T>`               | `<T: ?Sized + Sync> Send`, `<T: ?Sized + Sync> Sync` (correct, keep)   | A-CUSTOM-INVARIANT (kept) |
| S-010563/4 | bun_threading    | `src/threading/RwLock.rs:157-158`                    | `RwLock<T>`                  | `<T: Send> Send`, `<T: Send + Sync> Sync` over `UnsafeCell<T>`         | A-CUSTOM-INVARIANT (kept — mirrors `parking_lot::RwLock`) |
| S-010528/9 | bun_threading    | `src/threading/channel.rs:47-49`                     | `Channel<T, B>`              | `<T: Send, B: ..> Send/Sync` over `UnsafeCell<LinearFifo<...>>`        | A-CUSTOM-INVARIANT |
| S-010551   | bun_threading    | `src/threading/guarded.rs:38`                        | `GuardedBy<Value, M>`        | `<Value: Send, M: RawMutex + Sync> Sync` over `UnsafeCell<Value>`      | A-CUSTOM-INVARIANT |
| S-001117/8 | bun_core         | `src/bun_core/atomic_cell.rs:65-66`                  | `AtomicCell<T>`              | `<T: Copy> Send/Sync` over `UnsafeCell<T>`                             | A-CUSTOM-INVARIANT (mirrors `crossbeam::AtomicCell`) |
| S-001159/60| bun_core         | `src/bun_core/atomic_cell.rs:503-504`                | `ThreadCell<T>`              | `<T: ?Sized> Sync`, `<T: ?Sized + Send> Send` over `UnsafeCell<T>` + debug owner latch | A-CUSTOM-INVARIANT |
| S-001532/3 | bun_core         | `src/bun_core/util.rs:2282-2283`                     | `RacyCell<T>`                | `<T: ?Sized> Sync`, `<T: ?Sized + Send> Send` over `Cell<T>`           | A-CUSTOM-INVARIANT |
| S-001540/1 | bun_core         | `src/bun_core/util.rs:2691-2692`                     | `Once<T, F>`                 | `<T: Send + Sync, F: Sync> Sync`, `<T: Send, F: Send> Send` over `UnsafeCell<MaybeUninit<T>>` | A-CUSTOM-INVARIANT (mirrors `std::sync::OnceLock`) |
| S-000189/90| bun_alloc        | `src/bun_alloc/MimallocArena.rs:112,120`             | `MimallocArena`              | unconditional `Send/Sync` on `NonNull<mimalloc::Heap>` + thread-lock   | A-RAW-PTR-TO-C-STATE |
| S-000054/5 | bun_alloc        | `src/bun_alloc/heap_breakdown.rs:135-136`            | `Zone`                       | unconditional `Send/Sync` on `opaque_ffi!` macOS malloc-zone handle    | A-RAW-PTR-TO-C-STATE |
| S-000310/1 | bun_boringssl    | `src/boringssl/lib.rs:120,125-126`                   | `CtxStore`                   | unconditional `Send/Sync` on `NonNull<boring::SSL_CTX>`                | A-RAW-PTR-TO-C-STATE |
| S-007197/8 | bun_runtime      | `src/runtime/node/fs_events.rs:208-209`              | `CoreFoundation`             | unconditional `Send/Sync` on dlopen handle + fn pointers               | A-RAW-PTR-TO-C-STATE |
| S-001973   | bun_http         | `src/http/h3_client/PendingConnect.rs:179`           | `Resolved`                   | unconditional `Send` (lsquic handle)                                   | A-RAW-PTR-TO-C-STATE |
| S-000661/2 | bun_bundler      | `src/bundler/linker.rs:102-107`                      | `ImportPathsListPtr`         | unconditional `Send/Sync` on `NonNull<ImportPathsList>` (mutex-guarded) | A-RAW-PTR-TO-C-STATE |
| S-000394/5 | bun_bundler      | `src/bundler/bundle_v2.rs:1536-1544`                 | `CompletionHandle`           | unconditional `Send/Sync` on `NonNull<JSBundleCompletionTask>` + `&'static CompletionDispatch` | A-CUSTOM-INVARIANT |
| S-000671/2 | bun_bundler      | `src/bundler/LinkerContext.rs:233-240`               | `LinkerContext<'a>`          | `<'a> Send/Sync` over many raw-ptr backrefs + atomics                  | A-CUSTOM-INVARIANT |
| S-000715/6 | bun_bundler      | `src/bundler/LinkerContext.rs:1615-1633`             | `GenerateChunkCtx<'a>`       | `<'a> Send/Sync` — composed of `ParentRef`/`BackRef` only              | **C-USE-ASSERTIONS** |
| S-003567/8 | bun_jsc          | `src/jsc/JSCell.rs:118-128`                          | `JsCell<T>`                  | `<T> Sync`, `<T> Send` unconditional over `UnsafeCell<T>`              | A-CUSTOM-INVARIANT (the lie is the contract — see `src/jsc/CLAUDE.md`) |
| S-003764/5 | bun_jsc          | `src/jsc/VirtualMachine.rs:611-612`                  | `VirtualMachine`             | unconditional `Send/Sync` on per-thread singleton                      | A-CUSTOM-INVARIANT |
| S-003354   | bun_jsc          | `src/jsc/ConcurrentPromiseTask.rs:55`                | `ConcurrentPromiseTask<'_,C>`| `<C: ..> Send` — task-handoff invariant                                | A-CUSTOM-INVARIANT |
| S-003949   | bun_jsc          | `src/jsc/WorkTask.rs:58`                             | `WorkTask<C>`                | `<C: ..> Send` — task-handoff invariant                                | A-CUSTOM-INVARIANT |
| S-009717/8 | bun_semver       | `src/semver/SemverQuery.rs:117-132`                  | `List`                       | unconditional `Send/Sync` — `tail: Option<NonNull<Query>>` is self-ref into `head` | A-CUSTOM-INVARIANT |
| S-004633/4 | bun_resolver     | `src/resolver/fs.rs:1824-1835`                       | `EntriesOption`              | unconditional `Send/Sync` — `Box<DirEntry>` containing `*mut Entry` into BSS singleton | A-CUSTOM-INVARIANT |
| S-008147/8 | bun_runtime      | `src/runtime/shell/IOReader.rs:82-83`                | `IOReader`                   | unconditional `Send/Sync` — owns raw pollable fd                       | A-RAW-PTR-TO-C-STATE |
| S-002078/9 | bun_http         | `src/http/ssl_config.rs:444-445`                     | `SSLConfig`                  | unconditional `Send/Sync` — owns BoringSSL `SSL_CTX*`                  | A-RAW-PTR-TO-C-STATE |
| S-000508/9 | bun_bundler      | `src/bundler/Chunk.rs:133-134`                       | `Chunk`                      | unconditional `Send/Sync` over many raw-ptr fields + `CompileResultSlots` | A-CUSTOM-INVARIANT |

---

## Risk per Subclass

### C-PROPAGATE — Low risk

The `NonNull<T> + PhantomData<T>` refactor changes nothing at runtime: `NonNull`
is layout-identical to `*mut T` (both are `repr(transparent)` pointer-sized),
and `PhantomData` is a ZST. The bound the auto-derive produces is *stricter*
than (or equal to) what the manual impl asserts — so any caller that previously
compiled still compiles. The only callers that break are those that *should
have* failed to compile against the manual impl but didn't because the bound
was missing (e.g. `SendPtr<Cell<u32>>` in dns.rs). Those are bugs being
revealed, not regressions.

**Verification per PR:** `cargo check --workspace --all-targets` plus a
targeted `cargo test -p bun_<crate>` for any crate that touches the refactored
type.

### C-USE-ASSERTIONS — Negligible risk

Adding a compile-time `T: Send + Sync` assertion is a compile-time
no-op except for the case where the assertion *fails*, in which case the
auto-derive has silently degraded and we want to know. Removing the
`unsafe impl` is sound only after the assertion compiles; do them in the same
commit. Workspace-wide rollout in one PR per crate is feasible.

### C-REMOVE-IMPL / C-CONSOLIDATE — Low risk

Both require running through call sites first. For `SendPtr` consolidation,
introduce `bun_ptr::SendPtr<T>` in one PR and migrate callers in follow-up PRs
one site at a time (each site is one struct removal + one import addition).

### A-RAW-PTR-TO-C-STATE — No refactor

These impls are correct and documented; the underlying C library guarantees
threadsafety on the opaque handle (BoringSSL, mimalloc, libuv, CoreFoundation).
Leave them; they should each carry a `// SAFETY:` comment citing the C-library
guarantee, and most do.

### A-CUSTOM-INVARIANT — No refactor (but document)

These impls express a structural invariant the type system cannot. The
canonical example is `VirtualMachine`: it is a per-thread singleton, but
declaring it `!Send`/`!Sync` would force `Strong`/`Weak`/JSCell to cascade the
same bound through every JS-adjacent type. The impl is a deliberate "lie"
discharged by the architectural invariant.

The risk is *future maintainers misreading the impl as a free pass* — i.e.
adding a `Cell<u32>` field to `VirtualMachine` and assuming the existing
`unsafe impl Sync` still discharges it. Mitigation: every A-CUSTOM-INVARIANT
impl must carry a `// SAFETY:` block naming the invariant; the audit can
verify presence/quality of these comments as a separate pass (most are
already in good shape — see `JsCell`, `RacyCell`, `Once`, `MimallocArena`).

---

## PR Landing Order

Five PRs, each independently reviewable and revertable:

1. **PR #1 — `bun_ptr::SendPtr<T>` central helper** (low-risk, foundational).
   Adds the new type with a single-paragraph doc + a compile-time trait assertion.
   No call-site changes. Locks in the refactor pattern this cluster's other
   PRs depend on.

2. **PR #2 — Fix `StoreSlice<T>` soundness bug**
   (`bun_ast::nodes::StoreSlice`). Add the `T: Send` / `T: Sync` bounds to
   match the sister `StoreRef<T>` impls. Audit downstream call sites to confirm
   no existing code was relying on the unsound `<T>` form. Highest-priority
   PR because it closes a latent UB hole.

3. **PR #3 — Migrate the 4 `SendPtr` duplicates** (`bun_bundler`,
   `bun_runtime`, `bun_jsc::web_worker`, `bun_jsc::Debugger`). Each call site
   becomes:
   ```rust
   use bun_ptr::SendPtr;
   let send = SendPtr::new(NonNull::new(ptr).expect("..."));
   ```
   Net diff: −4 `unsafe impl Send` lines, −4 ad-hoc `struct SendPtr` blocks.

4. **PR #4 — `C-PROPAGATE` retrofit on owning collections**
   (`MultiArrayList`, `RawSlice`, `StringHashMapKey`, `BSSList`). One commit
   per type; each replaces `*mut T` / `*const [T]` with `NonNull<T>` +
   `PhantomData<T>` and deletes the `unsafe impl<...> Send/Sync` lines. Verify
   `cargo check --workspace` plus the relevant `bun bd test` suite. **~16
   `unsafe impl` lines removed.**

5. **PR #5 — `C-USE-ASSERTIONS` sweep across all subclass-(C) sites.** For
   each struct in subclass C-USE-ASSERTIONS, delete the `unsafe impl
   Send/Sync` lines and add compile-time trait assertions
   in a `const _ = { ... };` block. **~10 `unsafe impl` lines removed.**

PRs 3–5 land independently. Total deletion target: **≈46 `unsafe impl` lines**
across 22 crates, with one latent unsoundness bug closed (`StoreSlice`) and
one duplicated helper consolidated (`SendPtr`). The remaining ≈111 manual
Send/Sync impls are correctly load-bearing (C handles, single-thread-affine
JS state, mutex-guarded `UnsafeCell` containers); each will be re-verified
during the audit's follow-on `// SAFETY:` comment pass.

---

## Appendix: Extraction Query Reference

The categorization used here was driven from the inventory JSONL with:

```bash
jq -c 'select(.categories | (index("send_impl") or index("sync_impl") or index("other_unsafe_impl")))' \
    .unsafe-audit/unsafe-inventory.jsonl > /tmp/sendsync.jsonl

# Generic (propagating) impls only:
jq -c 'select(.categories | (index("send_impl") or index("sync_impl"))) | select(.normalized | contains("<"))' \
    /tmp/sendsync.jsonl

# Per-trait breakdown of other_unsafe_impl:
jq -r '.normalized' /tmp/sendsync.jsonl \
    | grep -oE 'unsafe impl(<[^>]+>)?\s+[a-zA-Z_:]+' \
    | sed -E 's/^unsafe impl(<[^>]*>)?\s+//;s/^.*:://' \
    | sort | uniq -c | sort -rn
```

All site IDs in this plan map directly to inventory rows; cross-check via
`grep S-XXXXXX .unsafe-audit/unsafe-inventory.jsonl`.
