# Phase 3 — Refactor Clusters

This document groups the 11,044 unsafe sites into refactor clusters. Each cluster has:

- A primary classification (A/B/C) — with caveats per-site
- A reach (site count + crate distribution)
- A refactor pattern (for (C) clusters) or a hardening pattern (for (A)/(B))
- A risk assessment

Clusters are ordered by **expected refactor value** = (potential safe sites) × (blast radius) × (discoverability) — see `RISK-SCORING.md` for the formula. Top clusters are the candidates for the demonstration PR.

## Codex pass 2 amendment

This Phase 3 document is a first-pass cluster map. Apply the Codex pass-2
corrections before using it for Phase 11:

- C-001 has 22+ firm safe rewrites until the `const fn` site is excluded or solved.
- C-002 should use `strum::FromRepr`, not `num_enum`.
- C-003 assertion rewrites must not assume `static_assertions` is already present.
- B clusters are B-candidates until benchmark logs are attached.

---

## C-001 — `NonNull::new_unchecked` from reference-sourced pointers

**Reach:** ~50 sites within the `pin_unchecked` category (62 total, minus ~12 that are genuinely from FFI-supplied pointers).

**Classification:** **(C) REFACTORABLE.**

**Pattern.** `unsafe { NonNull::new_unchecked(<ptr from a reference>) }`. Example:

```rust
// Before:
unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) }
```

**Safe rewrite.** `NonNull::from(&r).cast_mut()` is already in stable Rust and produces identical codegen:

```rust
// After:
NonNull::from(r).cast_mut()
// or with explicit type:
NonNull::<_>::from(r).cast_mut()
```

**Risk:** Low. The semantic is provably equivalent: both forms produce a non-null pointer with the same provenance.

**Falsification test.** Compile both forms with `-Copt-level=2` and compare assembly. They should be byte-identical.

**Sites to land first (demo-PR candidates):**
- `bun_ast/src/ast/nodes.rs:82` — `unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) }` → `NonNull::from(r).cast_mut()`
- `bun_collections/src/collections/array_hash_map.rs:1578` — sourced from a slice
- `bun_bundler/src/bundler/BundleThread.rs:409` — sourced from `bundle_thread.cast::<()>()` if `bundle_thread` is non-null at that point
- ~47 other sites

**Verify-by-equivalence:** Property test asserts both forms yield the same `*const T` for any non-null input.

---

## C-002 — `mem::transmute` of integer-to-enum where input is bounded

**Reach:** ~8 of the 30 `mem_transmute` sites.

**Classification:** **(C) REFACTORABLE** for sites where input is bounded; **`pre-existing-ub-N`** bead for sites where input could carry arbitrary values.

**Pattern.**
```rust
unsafe { mem::transmute::<u16, MyEnum>(n) }
```

**Safe rewrite via `strum::FromRepr`:**

```rust
// Definition:
#[derive(strum::FromRepr)]
#[repr(u16)]
enum MyEnum {
    A = 0,
    B = 1,
    // ...
}

// Use site:
MyEnum::try_from(n).expect("validated upstream by <caller>")
```

For hot paths where the bounds check is measurable, the `expect` lowers to `unreachable_unchecked!` (still safe — `expect` is checked) or stays the same speed under `-Copt-level=3` after the input bound is propagated.

**Sites:**
- `bun_libuv_sys/src/libuv_sys/libuv.rs:292` — `transmute::<c_int, HandleType>(raw)`. `raw` comes from `uv_handle_type`'s C return — bounded by libuv's contract. Safe to `TryFrom`; if libuv ever adds a new type we get a clean error instead of UB.
- `bun_errno/src/errno/lib.rs:310` — `transmute::<u16, SystemErrno>(n)`. `n` is an errno — bounded.
- `bun_cares_sys/src/cares_sys/c_ares.rs:2049` — `transmute::<i32, Error>(n as i32)`. `n` is c-ares error code — bounded.
- `bun_bundler/src/bundler/linker_context/scanImportsAndExports.rs:1681` — `transmute::<u16, PropertyIdTag>(...)`. Input is `u16::try_from(property_tag)`; if `PropertyIdTag` doesn't cover all `u16` values, this is **latent UB** today.

**Risk:** Low for sites with bounded input. Medium for sites where the bound is folklore (we'll add the runtime check; expect may panic on bad input — finds the bug instead of UB'ing).

**Pre-existing-UB candidates:**
- Any `transmute::<u16, EnumType>` where the enum doesn't cover all `u16` values AND the input bound isn't enforced in code (the parser can produce a value the enum doesn't have).

The audit will, per site, verify the bound and either land the (C) refactor or file the UB bead.

---

## C-003 — `unsafe impl Send/Sync` propagating a bound on T

**Reach:** ~40 of the 165 `send_impl` + `sync_impl` sites.

**Classification:** **(C) REFACTORABLE** for the propagating impls; **(A)** for impls on raw-pointer wrappers around C state.

**Pattern.**
```rust
struct Wrapper<T> { ptr: *mut T, ... }
unsafe impl<T: Send> Send for Wrapper<T> {}
unsafe impl<T: Sync> Sync for Wrapper<T> {}
```

**Safe rewrite.** Replace the raw pointer with `NonNull<T>` + `PhantomData<T>` (or `Box<T>` if owned). Then `Send`/`Sync` are auto-derived per the field's bounds, without `unsafe impl`:

```rust
// Before:
struct Wrapper<T> {
    ptr: *mut T,
    _ph: PhantomData<T>,
}
unsafe impl<T: Send> Send for Wrapper<T> {}

// After:
struct Wrapper<T> {
    ptr: NonNull<T>,
    _ph: PhantomData<T>,  // keeps T:Send semantics
}
// no unsafe impl needed — NonNull<T> is Send iff T is Send via the PhantomData
```

For non-owning views (raw pointer is the C-side's allocation), use `*mut T` BUT add `PhantomData<&'a mut T>` or `PhantomData<Cell<T>>` to encode the access pattern. Most of Bun's propagating-impls will benefit from this.

**Sites:**
- `bun_ast/src/ast/nodes.rs:39-40` — `StoreRef<T>` — propagating
- `bun_collections/src/collections/array_hash_map.rs:1558-1559` — `StringHashMapKey<A>` — propagating with `A: Allocator + ...`
- `bun_core/src/bun_core/atomic_cell.rs:65-66` — `AtomicCell<T: Copy>` — propagating
- `bun_css/src/css/declaration.rs:53-54` — `DeclarationBlock<'bump>` — `'bump` lifetime, not generic — may need different handling

**Risk:** Medium. Field-type changes can ripple through the codebase. Each site needs a per-site verification that the new field type compiles in every caller.

**Verify-by-equivalence:** `static_assertions::assert_impl_all!(Wrapper<MyT>: Send, Sync)` for each concrete instantiation Bun uses.

---

## A-001 — Zig-port `*mut Self` pattern at FFI callback sites

**Reach:** ~1,610 sites (`zig_port_mut_ref` 923 + `zig_port_shared_ref` 448 + `zig_port_self_call` 239) where the call site is an `extern "C"` callback or its body could be reached from one.

**Classification:** **(A) STRICTLY_UNAVOIDABLE.** Required by Stacked Borrows discipline per Invariant I-001.

**Pattern (load-bearing).**
```rust
pub unsafe extern "C" fn on_event_c_callback(this: *mut Self, ...) {
    // The C side may free `this` via close() before we return.
    // We MUST NOT form &mut *this here.
    Self::on_event(this, ...)  // *mut Self → *mut Self
}

pub unsafe fn on_event(this: *mut Self, ...) {
    // Inside this function, we can form &mut *this AFTER ruling out
    // the free-self path.
    let me = unsafe { &mut *this };
    // ... safe code ...
}
```

**Audit's contribution.** Verify each cluster site has:

1. A SAFETY comment naming the proof obligation (which callbacks can free; how the body rules out the free path before reborrowing)
2. The dispatch discipline (raw-pointer all the way down) is uniformly applied

Sites lacking the SAFETY comment get a hardening bead (Phase 8). Sites where the discipline is violated (a callback that CAN free reaches `&mut self`) are filed as `pre-existing-ub-N`.

**Where this CAN be (C):** Sub-cluster of these sites in PURE-RUST callers (no extern C). Some `Self::method(this, ...)` calls are pure-Rust dispatch where the maintainer copied the FFI pattern without need. These are (C) — just take `&mut self`. Phase 5 will enumerate the per-crate distribution.

---

## A-002 — `bun_core::heap::take` / `destroy` / `into_raw` round-trips

**Reach:** 204 sites.

**Classification:** **(A) STRICTLY_UNAVOIDABLE** at the round-trip boundary; the helper is just a wrapper for `Box::from_raw`/`Box::into_raw`.

**Audit's contribution.** Verify:

1. Every `into_raw` has a matching `take` or `destroy` on every exit path (including panic, async cancellation, FFI early return).
2. The pointer never escapes the documented owner before the matched return.
3. Drop-glue runs for the wrapped type on `destroy`.

Sites lacking the audit chain get a hardening bead. **No refactor proposed** — the unsafe is genuine FFI lifetime.

---

## A-003 — All `*_sys` crates' `extern "C"` blocks + FFI shims

**Reach:** `bun_uws_sys` (253), `bun_libuv_sys` (133), `bun_libarchive_sys` (39 in lib + 81 in helpers), `bun_cares_sys` (62), `bun_mimalloc_sys` (84), `bun_simdutf_sys` (52 across 2 files), `bun_tcc_sys` (34), `bun_lolhtml_sys` (41), `bun_picohttp_sys` (~67), `bun_zlib_sys` (~50), plus brotli/zstd/spawn/windows — total ~1,200+ sites.

**Classification:** **(A) STRICTLY_UNAVOIDABLE.** FFI requires `unsafe extern "C"`.

**Audit's contribution.** Per-`*_sys` crate, verify the FFI boundary contract is documented:

- What does the C side promise about each parameter (non-null? aligned? UTF-8?)
- What does the Rust side promise about each return (lifetime? error code semantics?)
- Is the boundary `unwind`-safe (does it use `catch_unwind` if Rust panics could cross C)?
- Are buffer-length parameters validated before being passed?

Most `*_sys` crates have implicit contracts from the C header; Bun's wrapper functions are where the documentation gap typically lives. **The audit's hardening output** = "for each `pub fn` in `bun_uws_sys` that takes a length parameter, the SAFETY comment names the upper bound."

---

## B-001 — `core::hint::unreachable_unchecked` in exhaustive match tails

**Reach:** ~12 of the 17 `compiler_hint` sites (the rest are `assert_unchecked` and similar).

**Classification:** **(B) PERF_ONLY.**

**Safe alternative.** `unreachable!()` — same semantics, adds a panic check on reach (which is supposed to be impossible). Cost: one branch + one panic-string materialization in the cold path.

**Sites:**
- `bun_bundler/src/.../transpiler.rs:1932`
- `bun_install/src/.../lockfile/Tree.rs:1131`
- `bun_jsc/src/.../generated.rs:409`
- ~9 others

**Plan.** Add `safe-only` Cargo feature:

```toml
[features]
safe-only = []
```

```rust
#[cfg(feature = "safe-only")]
unreachable!()

#[cfg(not(feature = "safe-only"))]
unsafe { core::hint::unreachable_unchecked() }
```

**Measure.** `cargo bench` + `hyperfine` + flamegraph on the relevant hot paths under both features. Publish numbers in `B-001-bench.md`.

**Expected outcome.** The diff is often unmeasurable (`unreachable!()` lowers to a `ud2` + unreachable IR after `cold` annotation, indistinguishable from `unreachable_unchecked` codegen). Where it is measurable, the site stays (B). Where it isn't, the site graduates to (C).

---

## B-002 — `get_unchecked` on bounded-index lookups

**Reach:** 13 sites.

**Classification:** **(B) PERF_ONLY.**

**Pattern.** `slice.get_unchecked(index)` where `index` is provably in-bounds.

**Safe alternative.** `slice[index]` — adds the bounds check. Often eliminable by LLVM if it can prove the bound; sometimes not.

**Plan.** Same `safe-only` feature flag as B-001. Measure per site.

**Sites:**
- `bun_base64/src/base64/lib.rs:606` — base64 decode table, 256-entry, `u8` index. Bounds check provably eliminable. (B), but the (B) cost is probably 0.
- `bun_install/src/install/lockfile/Tree.rs:1020` — `deps.get_unchecked(dep_id)`. Bounds elimination depends on whether LLVM can prove `dep_id < deps.len()`. Likely not — (B).
- `bun_core/src/.../immutable.rs:486` — string-internals access. Hot path.
- ~10 others

---

## B-003 — `MaybeUninit::assume_init` for in-place struct init

**Reach:** ~120 of the 182 `maybe_uninit` sites (rest are `MaybeUninit::zeroed`-style which is different).

**Classification:** **(B)/(C) depending on per-site analysis.**

**Pattern.** Bun's `init_at(this: *mut Self)` constructors initialize fields one-by-one via `addr_of_mut!((*this).field).write(...)`. The "construction is complete" assertion is implicit (not via `assume_init`).

These are mostly already safer than the typical `MaybeUninit` pattern. A `(C)` rewrite would use `MaybeUninit::write` per field (no unsafe needed for the `write` itself, only for the final `assume_init` step which Bun avoids).

**Plan.** Phase 5 will enumerate per-init-site and propose either:
- (C) — full safe rewrite using `MaybeUninit::write` chain + safe extraction
- (B) — keep the unsafe with a hardened SAFETY comment + clippy lint

**Expected mix.** ~60% (C) candidates; ~40% (A) at FFI boundaries where in-place init is required because the struct is too large to move.

---

## C-004 — Custom helper functions that wrap a single unsafe op

**Reach:** ~200 sites across `bun_core::ffi::*`, `bun_core::heap::*`, `bun_core::callback_ctx`.

**Classification:** Mixed (A)/(C).

**Examples.**
- `bun_core::ffi::slice(ptr, len)` (20 sites) — wraps `slice::from_raw_parts`. The helper centralizes the SAFETY contract but the unsafe is genuine. **(A)** at the FFI boundary; **(C)** for callers where `ptr` is sourced from a Rust slice's `.as_ptr()` (in which case `slice::from_raw_parts` is unnecessary — they already have a slice).
- `bun_core::ffi::zeroed_unchecked()` (34 sites) — wraps `mem::zeroed`. **(C)** for any caller where the type has a sensible `Default`; **(A)** for FFI struct init where `Default` doesn't exist.
- `bun_core::callback_ctx::<T>(ctx)` (10 sites) — wraps the raw-pointer cast for callback context retrieval. **(A)** — necessary at the FFI boundary.

**Plan.** Phase 5 will enumerate which callers can switch to the safe alternative.

---

## C-005 — `unsafe { Self::xxx(this) }` for pure-Rust methods

**Reach:** Subset of `zig_port_self_call` (239 total) where the body doesn't escape `this` to an FFI callback.

**Classification:** **(C) REFACTORABLE.**

**Pattern.** Method copied from the Zig pattern but called only from pure-Rust callers.

**Safe rewrite.** Take `&mut self` and call as `self.method()`.

**Plan.** Per-method, verify no caller is an `extern "C"` callback AND no callee path frees `self`. Where both are true, refactor.

**Risk:** Medium. Each method must be verified against its caller set. Static analysis from rustdoc-JSON would help — currently coarse.

---

## Demonstration PR candidate ranking

For Phase 11 user selection, the top candidates by **expected impact / risk ratio**:

| Cluster | Sites | Risk | Impact | Demo-PR notes |
|---------|------:|------|--------|---------------|
| C-001 NonNull::new_unchecked → NonNull::from | ~50 | Low | High | Single-line per-site change. Zero codegen impact. Removes ~50 `unsafe` keywords. Strong demo. |
| C-002 enum-from-int transmute → `strum::FromRepr` | ~8 | Low-Med | High | Replaces a real UB hazard (out-of-range integers). No new dependency after Codex pass-2 correction. |
| C-003 propagating Send/Sync → field type refactor | ~40 | Med | High | Removes the `unsafe impl` ceremony for trivially-correct propagation. Higher code churn per site. |
| B-001 unreachable_unchecked → safe-only feature | ~12 | Low | Medium | Demonstrates the `safe-only` Cargo feature pattern. Useful for selling the methodology. |
| C-005 internal-only `Self::xxx(this)` → `self.xxx()` | TBD | Med-High | Medium | Highest cluster value but needs precise call-graph; defer until rustdoc JSON works. |

**Recommendation for first demo PR:** **C-001 + C-002 combined.** Both are low-risk, mechanical refactors with clear before/after wins. ~58 sites total. Single PR demonstrates the audit's value without overreaching scope. The remaining clusters get filed as beads for incremental landing.
