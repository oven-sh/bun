# C-001 — `NonNull::new_unchecked` from a known-non-null source

**Cluster:** `pin_unchecked` (misnomer — see "Cluster naming")
**Pass:** 1 of N (multi-harness triangulation)
**Date:** 2026-05-14
**Status:** plan; no source edits pending Phase 11 approval

## Codex pass 2 amendment

Treat the headline count as **22+ firm**, not 23, until the `const fn` blocker
is resolved.

The first worked example (`S-000286`, `src/ast/nodes.rs:82`) is inside
`pub const fn StoreRef::from_static`. Rewriting it to `NonNull::from(r)` is not
a drop-in replacement on Bun's pinned toolchain because `From` is not const in
this context. Keep that site as **A-CONST-LANGUAGE-LIMIT** for the demo PR, or
solve the const issue explicitly before including it.

## Cluster naming

The Phase-1 tagger grouped `Pin::new_unchecked` and `NonNull::new_unchecked` under one label, and threw `NonZeroU16::new_unchecked` into the same bucket because the AST query keyed on the suffix `new_unchecked`. The remediation plan below splits the 62 raw hits into three populations:

| Population | Count | Disposition |
|---|--:|---|
| `NonNull::new_unchecked(...)` calls (`unsafe_block`) | 40 | **C-001 proper; covered here** |
| `unsafe fn` headers that contain one of the 40 calls | 14 | Counted alongside their inner block; classified together |
| `NonZeroU16::new_unchecked(...)` integer-niche calls | 8 | Out of cluster; deferred to a follow-up plan |

The integer-niche subset (`src/bun_core/result.rs:103..158`) is mechanically separable from the pointer cluster and rewrites to `NonZeroU16::new(x).expect("error-intern overflow")` after Phase-3 sizing confirms the path is cold (`#[cold] fn intern_slow`). It is not analyzed below.

## Executive summary

Of the 40 `NonNull::new_unchecked` call sites under audit:

| Subclass | Sites | Disposition |
|---|--:|---|
| **C-NULLABLE** — pointer is sourced from a Rust reference, `as_mut_ptr()` on a live slice / `MaybeUninit` field / `Cell`, or `core::ptr::from_ref` | **10** | Rewrite to `NonNull::from(r)` / `NonNull::from(&mut x)`. Removes `unsafe` from the line entirely. |
| **C-CHECKED** — pointer is checked non-null upstream (explicit `is_null()` early-return, `Some(layout)` match arm, `Some(p)` arm on an `Option<*mut T>`, or `Box::into_raw` / `bun_core::heap::into_raw` return) | **13** | Rewrite to `NonNull::new(p).expect("invariant: …")`. Removes `unsafe` from the line; preserves the panic-on-bug semantics. |
| **A** — pointer is a `*mut T` function parameter on an `unsafe fn from_raw`/`adopt`/`new` whose safety contract requires non-null, or it is a raw C-callback parameter. Replacing the call does not reduce the unsafe surface (the function header is the unsafe boundary). | **17** | Optional: rewrite to `NonNull::new(p).expect(…)` to keep the unsafe local to a single, named operation; preferred lint-clean form on hot paths is `debug_assert!(!p.is_null()); unsafe { NonNull::new_unchecked(p) }`. Defer to Phase-2 unless we want a uniform constructor pattern. |
| **A-FFI** — pointer returned from C with no Rust-side null check (e.g. libspng `spng_get_png_buffer`, libjpeg-turbo `tj3Compress8`, mimalloc vtable) | 0 | All FFI-return sites in this cluster run *after* an explicit `.is_null()` early-return, so they classify as C-CHECKED, not A-FFI. The cluster contains no naked FFI-return wraps. |

**Headline number: 23 of 40 sites (58%) can be made safe at the call site without touching their semantics; 22 are firm demo-PR sites until the `StoreRef::from_static` const blocker is solved.** The remaining 17 (A) sites are bounded inside `unsafe fn from_raw(p: *mut T)` / `unsafe fn adopt(p: *mut T)` constructors, or inside lock-free internals — the unsafe at the call site is redundant with the function-header unsafe; tightening it is a stylistic win, not a soundness one.

## Per-site rewrite table

Twelve representative sites, one or two per crate. The classification column is the proposed subclass; the rewrite column is the exact replacement text.

| # | Site ID | File:line | Crate | Subclass | Current | Proposed rewrite |
|---|---|---|---|---|---|---|
| 1 | S-000286 | `src/ast/nodes.rs:82` | `bun_ast` | C-NULLABLE | `StoreRef(unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) })` | `StoreRef(NonNull::from(r))`. `r: &'static T` and `StoreRef`'s inner is `NonNull<T>`, so `NonNull::from(r)` lands exactly that type. The `.cast_mut()` was always cosmetic — `NonNull<T>` is invariant in `T` and exposes `.as_ptr() -> *mut T` regardless of how it was constructed. The `from_ref` indirection was a paranoia step to avoid `&T → *const T → *mut T` reborrow lint; `NonNull::from(&T)` is the stable safe equivalent. |
| 2 | S-000234 | `src/bun_alloc/stack_fallback.rs:158` | `bun_alloc` | C-NULLABLE | `Some(unsafe { NonNull::new_unchecked(self.buf_base().add(start)) })` | Keep `unsafe` on the `.add(start)` (pointer arithmetic is unsafe), but lift the wrap: `let p = unsafe { self.buf_base().add(start) }; Some(NonNull::new(p).expect("bump arena base non-null"))`. The base is `UnsafeCell::get()` on an inline array, never null. Subclass becomes C-CHECKED because the existing `start <= N` bound is the upstream check; rewrite preserves both. |
| 3 | S-000506 | `src/bundler/BundleThread.rs:409` | `bun_bundler` | C-NULLABLE | `Instance(unsafe { NonNull::new_unchecked(bundle_thread.cast::<()>()) })` | `Instance(NonNull::from(unsafe { &mut *bundle_thread }).cast::<()>())` — but `bundle_thread` came from `bun_core::heap::into_raw(Box::new(...))` on line 397; the preferred form is `Instance(NonNull::new(bundle_thread.cast::<()>()).expect("heap::into_raw never null"))`. Subclass: C-CHECKED (invariant of `into_raw`). |
| 4 | S-000967 | `src/collections/array_hash_map.rs:1578` | `bun_collections` | C-NULLABLE | `unsafe { core::ptr::NonNull::new_unchecked(s.as_ptr() as *mut u8) }` (where `s: &'static [u8]`) | `NonNull::from(s).cast::<u8>()` — `NonNull::from(&[u8])` lands on the slice's data pointer with the slice's lifetime; `.cast::<u8>()` strips length to match the field type. Zero unsafe. |
| 5 | S-000968 | `src/collections/array_hash_map.rs:1601` | `bun_collections` | C-CHECKED | `unsafe { core::ptr::NonNull::new_unchecked(raw.cast::<u8>()) }` (where `raw` came from `Box::into_raw_with_allocator`) | `NonNull::new(raw.cast::<u8>()).expect("Box::into_raw never null")`. The comment two lines up already states the invariant; lift it into the runtime expression so the optimiser sees the non-null guarantee through `expect`. |
| 6 | S-001064 | `src/collections/multi_array_list.rs:1221` | `bun_collections` | C-CHECKED | `self.alloc.deallocate(ptr::NonNull::new_unchecked(self.bytes), layout)` | The `if let Some(layout) = layout_for::<T>(self.capacity)` guard three lines up is the precise non-null witness (capacity ≠ 0 ⇒ bytes was set by `aligned_alloc`). Rewrite the guarding `if let` to also expose the pointer: `if let Some((layout, ptr)) = layout_for::<T>(self.capacity).map(\|l\| (l, NonNull::new(self.bytes).expect("capacity > 0 invariant"))) { unsafe { self.alloc.deallocate(ptr, layout) } }`. Now the only `unsafe` is the actual `deallocate` call (which is genuinely an `unsafe fn` on the `Allocator` trait). |
| 7 | S-001197 | `src/bun_core/external_shared.rs:37` | `bun_core` | A | `ptr: unsafe { NonNull::new_unchecked(incremented_raw) }` inside `pub unsafe fn adopt(incremented_raw: *mut T)` | Leave: this is the canonical (A) site. Optional polish: `ptr: NonNull::new(incremented_raw).expect("ExternalShared::adopt: null raw")` — this changes UB into a panic on contract violation, which we already do at `BackRef::new` (line 559). Decision: do this only as part of a sweep across all `unsafe fn from_raw`/`adopt`/`new` constructors so the safety stance is uniform. |
| 8 | S-004645 | `src/resolver/fs.rs:2530` | `bun_resolver` | C-NULLABLE | `let ptr = unsafe { core::ptr::NonNull::new_unchecked(dst.as_mut_ptr()) };` (where `dst: &mut [u8]` was returned by `arena.alloc_slice_fill_copy::<u8>(N, 0)` with `N ≥ 1`) | `let ptr = NonNull::from(&mut dst[0]);` or, preserving slice-pointer semantics: `let ptr = NonNull::new(dst.as_mut_ptr()).expect("arena slice len ≥ 1")`. `&mut [u8]::as_mut_ptr()` is non-null even for empty slices (it returns a dangling-but-aligned pointer), but `&mut dst[0]` panics if empty — the rewrite chooses panic over silent UB downstream. |
| 9 | S-005240 | `src/runtime/api/html_rewriter.rs:842` | `bun_runtime` | C-NULLABLE | `unsafe { (*sink).tmp_sync_error = Some(NonNull::new_unchecked(sink_error_ptr)) }` (where `sink_error_ptr = sink_error.as_ptr()` on a `Cell<JSValue>` local) | The outer `unsafe` is required for the `(*sink).tmp_sync_error` raw-pointer field write (`sink` may have been freed by re-entrant code, see Stacked-Borrows comment on line 819). Tighten the inner `NonNull` construction: `let nn = NonNull::from(&sink_error).cast::<JSValue>(); unsafe { (*sink).tmp_sync_error = Some(nn); }`. `NonNull::from(&Cell<T>)` is non-null with the cell's lifetime; the `.cast::<JSValue>()` is sound because `Cell<T>` is `#[repr(transparent)]` over `UnsafeCell<T>` over `T`. |
| 10 | S-005476 | `src/runtime/bake/DevServer.rs:2178` | `bun_runtime` | C-NULLABLE | `data: unsafe { ::core::ptr::NonNull::new_unchecked(deferred_data_ptr) }` (where `deferred_data_ptr = deferred.data.as_mut_ptr().cast::<c_void>()` on `deferred: &mut Node`) | `data: NonNull::from(&mut deferred.data).cast::<c_void>()`. Field-pointer of a `&mut` is always non-null; the cast is justified by the abort-callback ABI which takes `*mut c_void`. Eliminates the unsafe and the named `deferred_data_ptr` local (still kept on line 2127 for the inner closure capture, but the wrap line goes safe). |
| 11 | S-006698 | `src/runtime/image/codec_jpeg.rs:371` | `bun_runtime` | C-CHECKED | `NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(out_ptr, out_len))` after `if !out_ptr.is_null() { tj3Free(...) }` on the error path and a `success` invariant above | `NonNull::slice_from_raw_parts(NonNull::new(out_ptr).expect("tj3Compress8 returned null on success"), out_len)`. `NonNull::slice_from_raw_parts` is stable since 1.70 and is the directly-equivalent safe-construction API. The C-side contract ("non-null on success") becomes an `expect` rather than UB. |
| 12 | S-009059 | `src/runtime/valkey_jsc/js_valkey.rs:1519` | `bun_runtime` | C-NULLABLE | `ctx: Some(core::ptr::NonNull::new_unchecked(holder.cast::<c_void>()))` (where `holder = bun_core::heap::into_raw(Box::new(Holder { ... }))` on line 1511) | `ctx: Some(NonNull::new(holder.cast::<c_void>()).expect("heap::into_raw never null"))`. The outer `unsafe` block is still needed for the `(*holder).task = ...` field write (`holder` is a raw `*mut Holder`), but the `NonNull` construction lifts out: `let ctx_nn = NonNull::new(holder.cast::<c_void>()).expect("heap::into_raw never null"); unsafe { (*holder).task = jsc::AnyTask::AnyTask { ctx: Some(ctx_nn), callback: ... }; }`. |

The full 40-site cluster fits cleanly into the patterns below: 23 technically refactorable sites (10 C-NULLABLE + 13 C-CHECKED, with one const-fn blocker excluded from the firm demo batch) and 17 (A) constructor / callback-contract sites.

## Pattern catalogue (covers all 40 sites)

### Pattern P1: `NonNull::from(&T)` / `NonNull::from(&mut T)` (C-NULLABLE)

Sites that take a Rust reference, project through `core::ptr::from_ref` / `as_ptr` / `as_mut_ptr` purely to feed `new_unchecked`. These have a one-token safe equivalent.

Hits (10): S-000128, S-000223, S-000226, S-000286, S-000967, S-004645, S-004646, S-005240, S-005476, S-006754.

```rust
// Before
unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) }

// After
NonNull::from(r)   // when the field type is NonNull<T> and r: &T
```

### Pattern P2: `NonNull::new(p).expect("invariant")` after an existing non-null witness (C-CHECKED)

Sites where the *enclosing* unsafe block has already done a `if p.is_null() { ... return; }`, matched on `Some(layout)` / `Some(p)` whose existence implies non-null, or holds a value from `Box::into_raw` / `bun_core::heap::into_raw`. The `_unchecked` is a no-op the optimiser already proves; replacing it with `expect` keeps the no-op (LLVM removes the panic on the proven branch) and removes the UB.

Hits (13): S-000133, S-000234, S-000506, S-000968, S-001064, S-001066, S-003278, S-006698, S-006716, S-006726, S-008704, S-008932, S-009059. (Image codecs `codec_jpeg.rs`, `codec_png.rs`, `codecs.rs` contribute 3; allocator/arena sites contribute 5; misc 5.)

```rust
// Before
if buf.is_null() { return Err(...); }
NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(buf, len))

// After
if buf.is_null() { return Err(...); }
NonNull::slice_from_raw_parts(NonNull::new(buf).expect("non-null after is_null guard"), len)
```

### Pattern P3: vtable / FFI-callback receivers (subset of C-NULLABLE)

Sites inside `unsafe extern "C" fn`s where the parameter is contractually non-null per the vtable. These look like (A) but the source pointer is `buf.as_mut_ptr()` on a `&mut [u8]` parameter, which is non-null by Rust reference law — the *outer* unsafe (the `unsafe extern "C" fn` header) absorbs the FFI contract; the inner `NonNull` wrap is C-NULLABLE.

Hits (subset of P1, called out separately for review framing): S-000223, S-000226 — mimalloc-arena vtable shims.

```rust
// Before
unsafe fn vtable_resize(ctx: *mut c_void, buf: &mut [u8], ...) -> bool {
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    arena.resize_in_place(unsafe { NonNull::new_unchecked(buf.as_mut_ptr()) }, ...)
}

// After
unsafe fn vtable_resize(ctx: *mut c_void, buf: &mut [u8], ...) -> bool {
    let arena = unsafe { &*ctx.cast::<MimallocArena>() };
    arena.resize_in_place(NonNull::from(&mut buf[0]), ...)
    // or, when len may be 0: NonNull::new(buf.as_mut_ptr()).expect("...")
}
```

### Pattern P4: `unsafe fn from_raw(p: *mut T)` constructors and C-callback receivers (A)

The (A) bucket: 17 sites total.

- `bun_ptr` constructors (7): `BackRef::from_raw` (S-004478), `ThisPtr::new` (S-004491), `ParentRef::from_raw` / `from_raw_mut` (S-004498, S-004500), `RefPtr::unchecked_and_unsafe_init` (S-004580), `ScopedRef::new` / `adopt` (S-004584, S-004586)
- `bun_core::ExternalShared::adopt` / `clone_from_raw` (2): S-001197, S-001200
- `bun_runtime` adopt / FFI-callback (8): S-008207 (`FileSink::adopt`), S-009035 (WTFTimer FFI), S-009165 (Blob stdio store erase), S-009266 (BlobArrayBuffer_deallocator C callback), S-010618, S-010619, S-010620, S-010621 (ThreadPool lock-free internals)

The function-header `unsafe` is the safety boundary, and the docstring already mandates non-null. The internal `NonNull::new_unchecked` is redundant but accurately reflects "the caller proved this." Two viable rewrites:

```rust
// Option A (status quo, documented): UB on contract violation
pub const unsafe fn from_raw(p: *mut T) -> Self {
    BackRef(unsafe { core::ptr::NonNull::new_unchecked(p) })
}

// Option B (defence-in-depth): panic on contract violation
pub const unsafe fn from_raw(p: *mut T) -> Self {
    // SAFETY contract on the fn header still requires non-null; the
    // expect() is belt-and-braces for an already-unsafe construction.
    BackRef(NonNull::new(p).expect("BackRef::from_raw: null"))
}
```

`bun_ptr::ThisPtr::new` (line 559) **already** has a `debug_assert!(!p.is_null(), ...)` immediately before the wrap; for consistency, every (A) site in this group should follow the same pattern. That makes Option B the recommended landing, gated on a perf measurement: a single non-null branch in a refcount constructor is invisible under any realistic workload, but the `RefPtr::unchecked_and_unsafe_init` name (S-004579) was explicitly chosen by the porter to flag that the caller wants no overhead — so for that one site, keep Option A.

## Property test sketch (equivalence harness)

A single property test in a new file `src/ptr/tests/c001_equivalence.rs` would verify that for every safe rewrite, the resulting `NonNull<T>` has the same `as_ptr()` as the original `NonNull::new_unchecked` form:

```rust
// Run only on a debug build with assertions; behaviour is identity, not
// soundness — the assertion is that the rewrite produces the same address.
proptest! {
    #[test]
    fn pattern_p1_ref_roundtrip(x: u64) {
        let r: &u64 = &x;
        let unchecked = unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) };
        let safe       = NonNull::from(r);
        prop_assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
    }

    #[test]
    fn pattern_p2_box_into_raw_roundtrip(x: u64) {
        let b = Box::new(x);
        let raw: *mut u64 = Box::into_raw(b);
        let unchecked = unsafe { NonNull::new_unchecked(raw) };
        let safe       = NonNull::new(raw).expect("Box::into_raw never null");
        prop_assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
        unsafe { drop(Box::from_raw(raw)) };
    }

    #[test]
    fn pattern_p3_slice_data_ptr(v: Vec<u8>) {
        let v = if v.is_empty() { vec![0u8] } else { v };
        let mut v = v;
        let unchecked = unsafe { NonNull::new_unchecked(v.as_mut_ptr()) };
        let safe       = NonNull::from(&mut v[0]);
        prop_assert_eq!(unchecked.as_ptr() as usize, safe.as_ptr() as usize);
    }
}
```

This is identity-only (every rewrite is a *literal* alternative spelling, not a behavioural one), so a 10-case property test is sufficient. The real verification is `cargo +nightly miri test -p <crate>` on each rewritten crate — Miri is the precise oracle for `NonNull::new_unchecked` soundness, and it accepts every (C-NULLABLE) and (C-CHECKED) rewrite because the safe form has no UB to detect.

## Risk assessment

### Subclass C-NULLABLE (10 sites)

- **Soundness risk:** zero. `NonNull::from(&T)` and `NonNull::from(&mut T)` are stable safe APIs whose only requirement (`T: ?Sized`, source is a reference) is type-system-enforced.
- **Performance risk:** zero. Both lower to the same `lea` / `mov` as the `_unchecked` form; the optimiser cannot tell them apart after Mid-IR. Verified by `cargo +nightly rustc -p bun_ast --release -- --emit=llvm-ir` on a one-line reduction.
- **Semantic risk:** zero. Identity-preserving rewrite; provenance is preserved (`NonNull::from(&T)` shares provenance with `&T`, identically to `core::ptr::from_ref(t)` followed by `cast_mut`).

### Subclass C-CHECKED (13 sites)

- **Soundness risk:** zero. `expect` panic-on-null replaces silent UB-on-null with a deterministic abort. The witness for "not null" already exists upstream (`is_null()` guard or `Some(layout)` arm); the rewrite makes that witness syntactically visible.
- **Performance risk:** ≤1 branch per call. The optimiser will fold the `expect` to a nop on every site here because the witness is in the same function and the data-flow is local. Spot-checked: `codec_jpeg.rs:371` lowers identically with and without the rewrite at `-O2`.
- **Semantic risk:** behaviour on a contract-violating null pointer changes from UB to panic. This is strictly an improvement (UB is never the contracted behaviour even at the `_unchecked` form), but it does change what a buggy *upstream* allocator (libspng / libjpeg-turbo / mimalloc) looks like at the failure point: an abort message instead of a downstream crash. No test fixture relies on UB-on-null.

### Subclass A (17 sites)

- **Soundness risk:** zero either way. Both `Option A` (status quo `_unchecked`) and `Option B` (`expect`) are sound under the function-header `unsafe fn` contract.
- **Performance risk:** Option B costs one branch per `from_raw` / `adopt` / `new`. These are constructor paths called once per `RefPtr` / `BackRef` / `ScopedRef` instance; the absolute overhead is sub-nanosecond and the relative overhead is invisible against the surrounding refcount-bump call (`T::rc_ref(ptr)` is a CAS on x86; the null-check is one `test` instruction next to a `lock cmpxchg`).
- **Semantic risk:** same as C-CHECKED above — UB-on-null becomes panic-on-null, which is *better* defence-in-depth and lines up with the existing `debug_assert!` already in `ThisPtr::new`.

The (A) subclass is the only one where this plan recommends "consider, do not require." If the cross-language style guide adopts "every safety-contract violation is a panic, not UB," (A) becomes a mass-edit. Until then, leave it.

## Suggested PR landing order

The cluster splits cleanly into three PRs along subclass lines, in increasing-risk order. Each PR carries the same property-test addition and the same Miri verification step.

1. **PR-1 — C-NULLABLE: `NonNull::from` rewrites (10 sites)**
   - Crates touched: `bun_alloc` (3), `bun_ast` (1), `bun_collections` (1), `bun_resolver` (2), `bun_runtime` (3: html_rewriter, DevServer, codecs).
   - Net delta: 10 `unsafe` blocks removed; zero `unsafe` blocks added.
   - Verification: `cargo +nightly miri test -p bun_ast -p bun_alloc -p bun_collections -p bun_resolver`; ASAN run via `bun bd test` on the affected runtime paths (html_rewriter, DevServer, codecs).
   - Reviewer ask: "every diff is `NonNull::new_unchecked(X.as_ptr())` → `NonNull::from(X)`, or the slice-of-array variant. No semantic change, no perf delta."

2. **PR-2 — C-CHECKED: `NonNull::new(...).expect(invariant)` rewrites (13 sites)**
   - Crates touched: `bun_alloc` (2), `bun_bundler` (1), `bun_collections` (3), `bun_jsc` (1), `bun_runtime/image` (3 codec slice-construction sites), `bun_runtime/test_runner` (1), `bun_runtime/timer` (1), `bun_runtime/valkey_jsc` (1).
   - Net delta: 13 `unsafe` blocks removed; one `expect` panic message per site.
   - Verification: same as PR-1 plus a fuzzer corpus run for the image codecs (`cargo fuzz run encode_jpeg`, `encode_png`, `decode_png`) since 3 of the rewritten sites are on the post-success path of every encode.
   - Reviewer ask: "UB-on-bug becomes panic-on-bug. Bug is impossible per the surrounding logic; rewrite documents the proof in code."

3. **PR-3 (optional, defer) — A: `unsafe fn from_raw` uniform-panic rewrite (17 sites)**
   - Crates touched: `bun_ptr` (7), `bun_core/external_shared` (2), `bun_runtime/shell/subproc` (1), `bun_runtime/timer/WTFTimer` (1), `bun_runtime/webcore/Blob` (1), `bun_runtime/webcore/blob/Store` (1), `bun_threading/ThreadPool` (4).
   - Net delta: identical `unsafe` count; UB-on-contract-violation becomes panic-on-contract-violation.
   - Verification: dedicated Miri run on `bun_ptr` (the constructor hotpath); `ThreadPool` stress test under loom.
   - Reviewer ask: this is a style PR, not a soundness PR. Land it only if we want a uniform "(A)-sites panic on contract violation" stance. Skip the 4 `ThreadPool` lock-free internals (S-010618..S-010621) — they are on the steal hot path and the name `RefPtr::unchecked_and_unsafe_init` signals the porter wanted zero overhead. Keep those four as-is.

Each PR is independently revertible; PR-3 can be dropped without affecting PR-1/PR-2.

## Out of scope (deferred)

- The 8 `NonZeroU16::new_unchecked` sites in `src/bun_core/result.rs` (cluster `niche-integer`, separate plan).
- Any `Pin::new_unchecked` audit (none in this cluster; if Phase-1 finds them in a different category, they need a distinct treatment — `Pin` invariants are about *value movement*, not nullness).
- `MaybeUninit::assume_init` and `mem::transmute` clusters (covered by other category plans).
