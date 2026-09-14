# Phase 3 — Soundness Invariants Bun's Unsafe Upholds

This document names the soundness invariants Bun's unsafe code is responsible for upholding. It synthesizes from the Phase 1 inventory and from `src/CLAUDE.md` which documents several of these explicitly.

Each invariant is **a property that must hold for the unsafe code to be sound**. The unsafe is "buying" the invariant from the language by promising the compiler that it will be true.

## I-001 — Pointer provenance discipline at FFI callback boundaries

**Reach:** 1,610+ sites carrying `zig_port_mut_ref`, `zig_port_shared_ref`, `zig_port_self_call`, or `raw_method_call` categories. Plus most `bun_heap_lifecycle` (204) and `raw_ptr_lifecycle` (537) sites.

**Invariant.** When a Rust function is the target of a C callback (registered via libuv, uWebSockets, mimalloc finalizers, JSC GC finalizers, BoringSSL callbacks, etc.) and the callback path may **free `self`**, the function MUST:

1. Take `this: *mut Self` (raw pointer), not `&mut self`.
2. Only form `&mut *this` / `&*this` INSIDE the body, AFTER any path that could free `self` has been ruled out for this scope.
3. Routes that free must dispatch through `*mut Self` end-to-end (`Self::method(this, ..)` form), never `(unsafe { &mut *this }).method(..)`.

**Why this is load-bearing under Stacked Borrows.** A `&self` / `&mut self` reborrow stamps the pointer's tag with `SharedReadOnly` (for `&`) or `Unique` (for `&mut`). Calling `Box::from_raw(self as *mut Self)` to drop the box reuses an EXPIRED borrow tag from the language's perspective — the previous `&` / `&mut` is still considered live in the borrow stack until its lifetime ends, and the dealloc invalidates it. Under strict Stacked Borrows (the model Tree Borrows still mostly implements for this case), this is UB. Pure miri runs catch it.

**Documentation.** `src/CLAUDE.md § Pointer provenance at FFI boundaries` documents this explicitly. The `impl_streaming_writer_parent!` macro in `src/io/PipeWriter.rs` (`bun_io` crate) encodes the three modes:
- `borrow = mut` — body forms `&mut *this`; safe when nothing re-enters
- `borrow = shared` — body forms `&*this`; safe when re-entrant code only needs `&Self`
- `borrow = ptr` — body calls `Self::method(this, ..)` with `this: *mut Self`; required when the callback may free `self`

**Verification.** miri with strict provenance + Stacked Borrows enabled would detect violations. The skill's verify.sh template runs `cargo +nightly miri test` with `-Zmiri-strict-provenance`. **Bun's test suite cannot be run end-to-end under miri** (the suite touches the JS engine, filesystem, and network heavily; miri's isolation would need to be disabled for nearly everything), but per-module miri runs on `bun_io::PipeWriter`-style modules are feasible.

**Classification consequence.** Sites upholding I-001 at FFI boundaries are **(A) STRICTLY_UNAVOIDABLE**. Sites following the same syntactic pattern but with no callback that can free self are **(C) REFACTORABLE** — they could just take `&mut self`.

## I-002 — JSC `Strong`/`Weak` thread affinity

**Reach:** Every `bun_jsc::Strong` / `bun_jsc::Weak` construction / destruction site (count TBD via call-graph; ~55 sites tagged `jsc_object_handle`).

**Invariant.** `bun_jsc::Strong<T>` keeps a JS value alive via a JSC GC handle. The type is `!Send`/`!Sync`. Construction and destruction MUST happen on the JS thread (the thread that owns the `JSGlobalObject` / `VirtualMachine`).

**Why.** JSC's GC is single-threaded; handle tables are per-thread; releasing a handle from the wrong thread either crashes JSC's `Heap::releaseGCHandle` or corrupts an unrelated thread's handle table.

**Documentation.** `src/CLAUDE.md § Strong / Weak JS handles`. Cross-thread string hazards are documented in the same file.

**Classification consequence.** All `Strong`/`Weak` lifecycle sites are **(A) STRICTLY_UNAVOIDABLE**. Their unsafety is bought from the language because the language cannot express "this type must be dropped on a specific thread" via the type system today. A `Strong` that is constructed on the JS thread and never sent elsewhere is already enforced by `!Send`; the unsafe comes from the moment `Strong` is built (the constructor is `unsafe fn create` because it takes the value's `+1` from JSC's stack-side refcount).

## I-003 — Refcount transfer on `to_js()` / `create()`

**Reach:** Every type that implements a `to_js` returning a wrapped pointer to a JSC object (many; needs Phase 2 enumeration).

**Invariant.** `to_js() / create()` returning a wrapped pointer **transfers** the caller's `+1` to the JS wrapper. The caller MUST NOT `ref()` again before the return.

**Symptoms of violation.** Extra `ref()` leaks until process exit. Missing `ref()` UAFs at the next GC cycle.

**Documentation.** `src/CLAUDE.md § Refcount transfer on to_js() / create()`.

**Classification.** Refcount-transferring sites are **(A) STRICTLY_UNAVOIDABLE** as long as the underlying object's lifecycle is owned by JSC's GC. The audit's task here is to verify that no site accidentally adds an extra `ref()` or drops one.

## I-004 — Atom-string thread-table affinity

**Reach:** Possibly every `bun_core::String` construction that crosses threads. Phase 2 needs to identify which `bun_core::String::*` callers are on non-JS threads.

**Invariant.** Atomized strings live in a **per-thread** atom-string table. Dropping an atomized string from another thread trips `wasRemoved` in `AtomStringImpl::remove()`.

**Mitigation pattern.** Build via `String::clone_utf8` (plain `WTFStringImpl`, atomic refcount) when the string may be dropped from a non-JS thread. Avoid `from_js` of an atomized JS string in cross-thread contexts.

**Documentation.** `src/CLAUDE.md § Cross-thread string hazards`. The example given is `src/runtime/webcore/fetch/FetchTasklet.rs` near `Response::init`.

**Classification.** This is the kind of invariant where (A) classification depends on whether the call site can be guaranteed to never cross threads. For HTTP/fetch worker pool sites: (A). For pure JS-thread contexts: the unsafe may be (C) once the audit proves the call is JS-thread-bound.

## I-005 — `MimallocArena` non-Drop semantics

**Reach:** Every type allocated in `bun_alloc::MimallocArena` (AST allocators, transpiler, parser arenas).

**Invariant.** `MimallocArena` bulk-frees backing pages on reset. Values inside DO NOT run `Drop`. Types owning heap allocations / refcounts / FDs MUST be freed explicitly BEFORE the arena resets.

**Documentation.** `src/CLAUDE.md § Memory & Allocators § Arena gotcha`. Also reinforced in the project root `CLAUDE.md`.

**Classification.** This is an architectural invariant. Arena allocations are themselves safe (`bumpalo::Bump`-style); the unsafety comes from anywhere code allocates a non-trivially-droppable type in the arena. This audit will identify such sites in Phase 2 and either:
- (C) — change the type to not own external resources
- (A) — keep the explicit-free pattern; document it
- (B) — switch to a Drop-honoring arena (e.g., generational arena), measure the perf cost

## I-006 — OOM cannot unwind through FFI

**Reach:** Every allocation that crosses FFI. `bun_core::handle_oom`, `bun_core::UnwrapOrOom` are the canonical helpers.

**Invariant.** A failed allocation must NOT unwind a panic into C code. The `handle_oom` helper converts `Result<T, AllocError>` into a controlled crash (currently via `std::process::abort()` or an equivalent).

**Documentation.** `src/CLAUDE.md § Memory & Allocators § OOM handling`.

**Classification.** This is a *safe* invariant maintained by the helpers, not an unsafe-block invariant. The `unsafe` keyword doesn't appear at `handle_oom` call sites. The audit notes this as **architectural context** for understanding why allocator-adjacent unsafe is rare in Bun's runtime crates.

## I-007 — Send/Sync field-level invariants for `unsafe impl`

**Reach:** 87 `unsafe impl Send` + 78 `unsafe impl Sync` + 188 other-`unsafe impl` = 353 sites.

**Invariant.** An `unsafe impl Send for T {}` asserts that T's owned data can be safely moved across threads. For types holding raw pointers, `Cell`, or `UnsafeCell`, the auto-derive doesn't fire and a manual `unsafe impl` is required IF the maintainer can prove the threading discipline holds.

**Categories in Bun's inventory:**

- **Wrappers around raw pointers that point to thread-stable data.** Common pattern: `struct Zone(*mut c_void); unsafe impl Send for Zone {}`. The raw pointer comes from mimalloc's `mi_heap_new` and points to heap state guarded by mimalloc's internal locks. (A) — without the manual impl, mimalloc handles couldn't move across worker threads.
- **`unsafe impl<T: Send> Send for Wrapper<T> {}`** — propagating Send through a generic wrapper that holds raw pointers. The bound makes the impl trivially correct given soundness of T's Send. (C) candidate — many of these could be replaced with structural refactors that restore auto-trait derivation, OR with compile-time trait assertions for checking without the `unsafe impl`.
- **`unsafe impl Send for SSLConfig {}` style** — holding C-allocated state that's only safe to drop on a specific thread or not safe to share across threads at all. Often the right call here is `!Send`/`!Sync` (don't implement them), then the type stays single-threaded. (C) candidate — verify whether cross-thread movement is actually needed.

**Classification.** Per cluster:
- Wrappers around `*mut`/`*const` to thread-stable C state: (A)
- Generic propagation with `<T: Send>` bound: (C) — refactorable with `NonNull` + `PhantomData`
- Types that don't actually need to cross threads: (C) — just remove the impl

## I-008 — Atomic ordering correctness

**Reach:** 101 atomic-tagged sites.

**Invariant.** Each atomic operation MUST use the weakest correct ordering. Bun's port from Zig defaulted many atomics to `Relaxed` (matching Zig's `.monotonic`). Some sites legitimately need `Acquire` / `Release` / `AcqRel` for happens-before relationships.

**Classification.** Each atomic site is (A) at the type level (the `Atomic*` types are safe in safe Rust, but `fence`, `compiler_fence`, and unsynchronized loads ARE unsafe). The audit's contribution here is verifying the ORDERING is correct, not removing the unsafe. **This is a (B)-adjacent dimension: correct-but-too-strong ordering is a perf regression; correct-but-too-weak is a soundness bug.**

## I-009 — `mem::transmute` lifetime extension is reachable from safe API only via documented contract

**Reach:** Subset of 30 `mem_transmute` sites, specifically the lifetime-extending ones (e.g., `transmute<MutexGuard<'_, ()>, MutexGuard<'static, ()>>`).

**Invariant.** When `mem::transmute` extends a lifetime, the caller must outlive the lifetime being created. Bun has at least one such site in `bun_alloc::lib.rs:559`:

```rust
unsafe {
    core::mem::transmute::<std::sync::MutexGuard<'_, ()>, std::sync::MutexGuard<'static, ()>>(g)
}
```

This is sound IF the call site holds the Mutex for the program lifetime, AND no thread can observe the guard dropping. Phase 5 plans will spell out the per-site proof obligation.

**Classification.** Lifetime-extending transmutes are (A) where the invariant is genuinely program-lifetime; (B)/(C) where a `scopeguard` or `OnceLock` could replace the extension.

## I-010 — Enum-from-integer transmutes are bound-checked

**Reach:** Subset of 30 `mem_transmute` sites, specifically `transmute::<u16, EnumType>` / `transmute::<i32, EnumType>` patterns.

**Examples found:**
- `bun_bundler/src/.../scanImportsAndExports.rs:1681` — `transmute::<u16, PropertyIdTag>(...)`
- `bun_cares_sys/.../c_ares.rs:2049` — `transmute::<i32, Error>(n as i32)`
- `bun_errno/.../lib.rs:310` — `transmute::<u16, SystemErrno>(n)`
- `bun_libuv_sys/.../libuv.rs:292` — `mem::transmute::<c_int, HandleType>(raw)`

**Invariant.** The integer input MUST be a valid discriminant of the target enum (i.e., it must be one of the explicitly-listed values). If the enum is `#[repr(u16)]` with all discriminants enumerated, the transmute is sound for those exact integer values. Out-of-range values are immediate UB.

**Classification.**
- Where the integer source is bounded (e.g., comes from a C error-code function whose return values are fully enumerated): (C) — `strum::FromRepr` / generated checked constructors provide a safe alternative with the same codegen shape on the success path
- Where the integer source could carry arbitrary values: this is **a latent UB bug**, file as `pre-existing-ub-N` bead, not a refactor — fix the input bounds-check first

## I-011 — `NonNull::new_unchecked` source non-nullity is proved

**Reach:** Many sites under `pin_unchecked` category (62 sites, mostly `NonNull::new_unchecked`).

**Invariant.** `NonNull::new_unchecked(ptr)` asserts `ptr != null`. Sound only if the caller can prove non-null.

**Examples found:**
- `bun_ast/.../nodes.rs:82` — `NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut())` — sourced from `&r`, so guaranteed non-null. (C) — could use `NonNull::from(r).cast_mut()` (no unsafe).
- `bun_collections/.../array_hash_map.rs:1578` — `NonNull::new_unchecked(s.as_ptr() as *mut u8)` — sourced from a Rust slice, guaranteed non-null. (C).
- `bun_core/.../external_shared.rs:34` — `NonNull::new_unchecked(incremented_raw)` — Zig `*T` is non-null by C-side construction. (A) at the FFI boundary; could be (C) by replacing the parameter type with `NonNull<T>` directly.

**Classification.** Most `NonNull::new_unchecked` sites in Bun are (C). The safe replacement `NonNull::from(&value)` or `NonNull::from(value)` works for any reference-sourced site, with identical codegen.

## I-012 — `get_unchecked` index is in-bounds

**Reach:** 13 sites.

**Examples:**
- `bun_base64/.../lib.rs:606` — `self.char_to_index.get_unchecked(c as usize)` — `c: u8` cast to `usize`, index range 0..256, table size 256. (B) PERF_ONLY — the bounds check would be redundant.
- `bun_install/.../Tree.rs:1020` — `deps.get_unchecked(dep_id as usize)` — `dep_id` validated upstream during lockfile parse.

**Classification.** All 13 sites are likely **(B) PERF_ONLY**. Each gets a safe alternative behind `safe-only` feature flag + measured perf delta in Phase 5 plans.

## I-013 — `unreachable_unchecked` is genuinely unreachable

**Reach:** 17 sites under `compiler_hint`.

**Examples:**
- `bun_bundler/.../transpiler.rs:1932`, `bun_install/.../lockfile/Tree.rs:1131`, `bun_jsc/.../generated.rs:409` — all `core::hint::unreachable_unchecked()` in match-arm tails after an exhaustive enum match.

**Classification.** **(B) PERF_ONLY.** The safe alternative is `unreachable!()`, which adds a panic check. Whether the check is measurable depends on hot-path frequency. The audit will measure.

## I-014 — `UnsafeCell` interior mutability discipline

**Reach:** 28 sites.

**Invariant.** `UnsafeCell<T>` allows mutation through `&UnsafeCell<T>`, but the caller MUST ensure no other reference exists at the time of mutation (no aliasing).

**Examples:**
- `bun_core/.../atomic_cell.rs:75` — `UnsafeCell::new(value)` — wrapping `T: Copy` for thread-local atomic-like access. Likely (A) — `Cell<T>` doesn't expose the same Send/Sync surface for non-Copy types.
- `bun_alloc/.../stack_fallback.rs:76` — `UnsafeCell::new([MaybeUninit::uninit(); N])` — stack-fallback allocator's backing buffer. Has to be `UnsafeCell` because the allocator gets `&self` calls but mutates the buffer. (A) — `Cell<MaybeUninit<...>>` doesn't compose with arrays the same way.

**Classification.** Most are (A) or (B); few (C) candidates.

## I-015 — `MaybeUninit::assume_init*` runs only after every field is written

**Reach:** 182 sites.

**Invariant.** `MaybeUninit<T>::assume_init()` asserts every byte is initialized. Sound only after every field has been written via `addr_of_mut` + `write`.

**Pattern.** Common in Bun's `init_at(this: *mut Self)` constructors that initialize in-place to avoid moving large structs.

**Classification.**
- For full-struct init: (C) candidate — `MaybeUninit::write` per field has a safe form; the safe form differs from the current by ~no codegen
- For partial init (only some fields, others later): (A) until the order can be made total

## Summary

Bun's unsafe surface is dominated by **three structural invariants** (I-001, I-005, I-007), each of which is genuinely load-bearing for what the project is trying to do. The remaining invariants (I-002 through I-015) each touch dozens to hundreds of sites with mixes of (A)/(B)/(C) outcomes per the per-site call-graph reality.

**This is not a project that has "too much unsafe"** in the sense of careless overuse — the unsafe is heavily structured around documented patterns that the language can't express today. **The audit's value is in:**

1. **Finding the (C) sites** that follow the same syntactic pattern but don't need the unsafe (e.g., `&mut *this` sites whose caller is pure Rust)
2. **Hardening SAFETY comments** for the (A) sites (currently most lack a SAFETY comment naming the proof obligation; this is the highest-impact improvement)
3. **Naming the (B) sites** explicitly and offering a `safe-only` feature flag for measurement
4. **Finding latent UB** (e.g., I-010 enum-from-integer transmutes whose input bounds aren't checked)
