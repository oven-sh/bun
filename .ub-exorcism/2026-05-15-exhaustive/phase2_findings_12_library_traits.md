# Phase 2 — Bucket 12 Findings: Std-Library Trait Invariants

**Run:** `2026-05-15-exhaustive`
**Bucket:** 12 — Std-Library Trait Invariants (`Hash`+`Eq`, `Eq`+`Ord`, `Iterator::size_hint`,
`GlobalAlloc`/`Allocator`, `Hasher::write`, project-local trait contracts that `unsafe` code trusts)
**Source skill ref:** `references/UB-TAXONOMY.md` §12
**Author:** Phase 2 static-bucket-sweeper for Bucket 12
**Cross-refs:** EXP-014 (`Slice<T>: Copy` — already in registry as Aliasing-bucket lead)

---

## Bucket scope clarification

Trait drift in safe-only traits (`Hash`, `Eq`, `Ord`, `Iterator`, `ExactSizeIterator`,
`Hasher`) is, by itself, **not UB** — std's `HashMap`/`BTreeMap`/`Vec::extend` only
mis-behave (silent miss, infinite loop, leak). It rises to UB only when:

1. An `unsafe` block downstream **relies** on the trait's invariant — e.g. a custom
   container using `unsafe` indexing that trusts `ExactSizeIterator::len()`, or a
   `TrustedLen` impl (gated, nightly-only).
2. A custom `Allocator`/`GlobalAlloc` returns a pointer that **violates** size or
   alignment guarantees; downstream `Vec` writes then over-run or mis-align.
3. A `Hasher::write` panics mid-hash and a downstream `unsafe` writer trusts that
   it ran to completion (extremely rare; not seen here).

So this report distinguishes **soundness drift** (1–3) from **correctness drift**
(silent collisions / lookup misses / capacity under-estimates). Both are listed,
but only soundness-class findings feed the Phase 5 / Phase 11 queues.

---

## Phase 1 / workspace inventory totals (this bucket)

| Trait family | Workspace `src/` count | Notes |
|---|---|---|
| `impl Hash for` | 1 (`KeyframesName`) | + 1 inside `bun_ast::Ref` (lib.rs:405) |
| `impl PartialEq for` | 16 | majority are pointer-identity or tag-only on AST refs |
| `impl Eq for` | 11 | always paired with `PartialEq` above |
| `impl (PartialOrd\|Ord) for` | 4 (2 pairs: `StableRef`, `PackQueueItem`) | |
| `impl Iterator for` | 13 | none impl `TrustedLen`; 6 also impl `ExactSizeIterator` |
| `impl ExactSizeIterator for` | 6 (`zig_hash_map::{Iter,IterMut,Keys,Values,ValuesMut}`, `MemberListIter`) | |
| `impl Allocator for` (`unsafe impl`) | 5 (`ArenaPtr`, `MimallocHeapRef`, `&MimallocArena`, `DefaultAlloc` hashbrown bridge, test-only `Counting`) | + the trait is re-exported as a marker by `bun_alloc::Allocator` |
| `impl GlobalAlloc for` | 1 (`Mimalloc` — the `#[global_allocator]`) | |
| `impl Hasher for` | 0 in `src/`; `bun_wyhash::OneShotHasher` is the only project-local hasher, defined via `core::hash::Hasher` blanket in the wyhash crate root | |
| `impl ArrayHashContext for` | 4 (`AutoContext`, `StringContext`, `CaseInsensitiveAsciiStringContext`, `EffectiveUrlContext`) | project-local Hash/Eq trait, not std |

Single `Hash` impl in `src/` for a real type (`KeyframesName`); the `bun_ast::Ref`
hash impl lives in `src/ast/lib.rs:405-410`. **One Iterator (`ArgvIter`)** never
overrides `size_hint`; the six `ExactSizeIterator`-claiming ones do. No `TrustedLen`
impls anywhere — the soundness-critical hot path is closed.

---

## Cross-refs to existing EXP entries

| EXP-ID | file:line | severity | one-line |
|---|---|---|---|
| EXP-014 | `src/collections/multi_array_list.rs:540-568` | CONFIRMED_UB | `Slice<T>: Copy` allows overlapping `ColMut` views — this is a **project-local trait-contract drift** that unsafe code (`split_mut`) trusts; tracked under Bucket 1 lead but also belongs in Bucket 12's "project-local trait invariants" sub-scope |

EXP-014 is the canonical Bucket 12-class finding even though it's filed under
Bucket 1 (Aliasing). The `Copy` impl is a **safe-trait** assertion, but
`MultiArrayList::Slice::items_mut(&mut self) -> &mut [F]` is an `unsafe`-adjacent
API that **trusts** the implicit "one-`Slice`-at-a-time" contract that `Copy`
breaks. This is the textbook §12 shape: a safe trait drift that arms an
unsafe boundary.

---

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | summary |
|---|---|---|---|---|
| F-L-1 | `src/ast/lib.rs:398-410` | **CORRECTNESS_DRIFT** (Hash/Eq forward direction violated) | 12 | `Ref::hash(self) = hash(self.as_u64())` (all 64 bits) but `Ref::eql` masks out the 3-bit user lane (bits 28..30). Two refs that are `eq` but have different user bits hash differently → `k1 == k2 ⇒ hash(k1) == hash(k2)` is broken. Map lookups can silently miss. **Self-acknowledged in the in-source comment.** |
| F-L-2 | `src/bundler/ungate_support.rs:107-129` | **CORRECTNESS_DRIFT** (Ord/Eq inconsistency) | 12 | `StableRef::cmp` orders by `(stable_source_index, ref.inner_index())` only; `StableRef::eq` requires `(stable_source_index, full r#ref)`. Two `StableRef`s with same `inner_index()` but different `tag` / `source_index` are `cmp == Equal` while `eq == false`. The only sort call site (`renameSymbolsInChunk.rs:162`) bypasses Ord via `sort_unstable_by(is_less_than)`, so the impl is **dead but wrong**; any future caller using `BTreeMap<StableRef, _>` / `sort_unstable()` / `binary_search` would silently mis-order. |
| F-L-3 | `src/runtime/bake/FrameworkRouter.rs:466-473` (`EffectiveUrlContext`) | **CORRECTNESS_DRIFT** (collisions = equality) | 12 | The `ArrayHashContext<EncodedPattern>::eql` impl returns `a.effective_url_hash() == b.effective_url_hash()` — **hash collision is treated as equality**. Two distinct dynamic routes whose 64-bit `effective_url_hash` collides will overwrite each other in `DynamicRouteMap`. Probability is astronomical for any plausible app, but the comparator does not actually compare *content*, only the hash that's already used for bucketing. Same code in Zig has the same shape; PORT NOTE matches. Not soundness, but a routing-table correctness bug under adversarial input. |
| F-L-4 | `src/css/rules/keyframes.rs:30-50` | **CORRECTNESS_DRIFT** (legal but degraded) | 12 | `KeyframesName::hash` writes only the underlying bytes; variant tag does not participate. `KeyframesName::Ident(b"foo")` and `KeyframesName::Custom(b"foo")` therefore hash equal but `eq` returns `false`. This is the **legal direction** of Hash/Eq drift (different keys may hash equal — fine; equal keys must hash equal — checked, holds). Documented in source as matching Zig. Listed for completeness; **no action**. |
| F-L-5 | `src/collections/zig_hash_map.rs:559-637` (`Iter`/`IterMut`/`Keys`/`Values`/`ValuesMut`) | **CORRECTNESS_DRIFT** (ExactSizeIterator dishonest under torn metadata) | 12 | All five `ExactSizeIterator` impls return `self.remaining` from `size_hint`. `remaining` is initialized from the map's `len` and decremented per yielded item; but if the underlying `metadata` slice is shorter than expected (corrupted state or torn read), `next()` will return `None` while `remaining > 0`. Std code does **not** rely on `ExactSizeIterator` for soundness (`TrustedLen` is the unsafe contract; not impl'd here). **Not a soundness issue**, but `Vec::from_iter` will over-allocate. Listed for completeness. |
| F-L-6 | `src/bun_alloc/lib.rs:624-657` (`unsafe impl GlobalAlloc for Mimalloc`) | **DEFENSIBLE** | 12 + 3 (alignment) | `realloc` routes through `mi_realloc` when `align ≤ MI_MAX_ALIGN_SIZE` (no explicit align arg) and `mi_realloc_aligned` otherwise. The Rust `GlobalAlloc::realloc` contract requires the returned pointer to satisfy the *original* `Layout::align()`. Mimalloc's documented behavior is to preserve the alignment of the original allocation (since the original was made via `mi_malloc_auto_align`), but this is a mimalloc-version-tied invariant. **Sound today**; flag if mimalloc is upgraded or replaced. |
| F-L-7 | `src/bun_alloc/stack_fallback.rs:348-405` (`ArenaPtr`) | **DEFENSIBLE** | 12 + 20 (alloc-pairing) | `ArenaPtr::deallocate` calls `mi_free` regardless of which arena allocated the pointer, citing "mimalloc free is heap-agnostic". Sound per mimalloc docs; this is the same invariant relied on by `MimallocHeapRef` (lines 456-505) and the `&MimallocArena` impl (per stack_fallback.rs:190 comment cross-ref). Documented; **no action**. |
| F-L-8 | `src/runtime/bake/FrameworkRouter.rs:451-461, 519-529` (`EncodedPatternIterator`, `StaticPatternIterator`) | **DEFENSIBLE** | 12 | Neither overrides `size_hint`; default `(0, None)` is honest. `read_with_size` does bounds-checked slicing. **No drift.** |
| F-L-9 | `src/wyhash/lib.rs` (`OneShotHasher`, `auto_hash`) | **DEFENSIBLE** | 12 | `auto_hash<K: Hash>` routes through std's `Hash` trait into a wyhash-backed `Hasher`. Drift in any callee `Hash` impl (e.g. F-L-1's `Ref::hash`) propagates through this path into `ArrayHashMap<Ref, _>` lookups — confirmed in `array_hash_map.rs:76`. The hasher itself is well-formed: `write_*` are pure folds, `finish` returns the accumulator, no panic paths. |

---

## Enumerations

### All `impl Hash for` in workspace `src/`

| crate | type | file:line | hash strategy | eq strategy | drift? |
|---|---|---|---|---|---|
| `bun_css` | `KeyframesName` | `src/css/rules/keyframes.rs:30-50` | bytes only (variant tag ignored) | per-variant bytes | LEGAL — `eq ⇒ hash eq` holds; reverse direction allowed to fail (F-L-4) |
| `bun_ast` | `Ref` | `src/ast/lib.rs:398-410` | `as_u64()` (full 64 bits incl. user bits) | `eql` masks user bits | **BROKEN** — `eq` does not imply `hash eq` (F-L-1) |

(`Derive(Hash)` sites are not enumerated; they are correct-by-construction since
they hash exactly the fields they compare. Derive sites are the majority.)

### All `impl Ord for` in workspace `src/`

| crate | type | file:line | cmp strategy | eq strategy | drift? |
|---|---|---|---|---|---|
| `bun_bundler` | `StableRef` | `src/bundler/ungate_support.rs:116-129` | `(idx, ref.inner_index())` | `(idx, full ref)` | **BROKEN** — F-L-2 |
| `bun_runtime::cli` | `PackQueueItem` | `src/runtime/cli/pack_command.rs:461-477` | reversed `strings::order(path, path)` | `path == path` | OK — `strings::order` is `cmp` |

### All `unsafe impl Allocator for` / `impl GlobalAlloc for`

| crate | type | file:line | backing | drift? |
|---|---|---|---|---|
| `bun_alloc` | `Mimalloc` (`GlobalAlloc`) | `src/bun_alloc/lib.rs:624-657` | mimalloc `mi_malloc_auto_align`/`mi_realloc`/`mi_free` | DEFENSIBLE (F-L-6) |
| `bun_alloc` | `ArenaPtr` | `src/bun_alloc/stack_fallback.rs:348-405` | `&MimallocArena` or global `mi_*` | DEFENSIBLE (F-L-7) |
| `bun_alloc` | `MimallocHeapRef` | `src/bun_alloc/stack_fallback.rs:456-505` | raw `mi_heap_t*` or global | DEFENSIBLE (same shape as F-L-7) |
| `bun_alloc::hashbrown_bridge` | `DefaultAlloc` | `src/bun_alloc/hashbrown_bridge.rs:81-...` | forwards to `std::alloc::Global` | OK (thin forwarder) |
| `bun_alloc::fallback::z` | `Z` | `src/bun_alloc/fallback/z.rs:21` | marker only; methods are inherent | OK (marker trait, no API exposed) |
| `bun_alloc::stack_fallback` test-only | `Counting` | `src/bun_alloc/stack_fallback.rs:529` | counts then forwards to `Global` | OK |
| (third-party mimalloc C library; no local vendor/mimalloc tree in this checkout) | — | — | — | out of scope |

### Project-local trait contracts that `unsafe` code depends on

Beyond `Slice<T>: Copy` (EXP-014), the following project-local traits are
asserted in safe code but trusted by `unsafe`:

| Trait / contract | file | unsafe consumer | risk |
|---|---|---|---|
| `Slice<T>: Copy` (multi_array_list) | `src/collections/multi_array_list.rs:556-557` (Send/Sync) + the `Copy` derive | `Slice::items_mut`, `split_mut` | **EXP-014 — CONFIRMED_UB** |
| `Ref` identity contract (mask user bits) | `src/ast/lib.rs:376` | callers using `Ref` as a `HashMap` key | F-L-1 — silent miss |
| `EffectiveUrlContext::eql` collision==equal | `src/runtime/bake/FrameworkRouter.rs:466-473` | `DynamicRouteMap` | F-L-3 — route conflation |

---

## Top 3 finds

1. **F-L-1 — `Ref` Hash/Eq forward-direction drift** (`src/ast/lib.rs:398-410`).
   `eq` masks the 3-bit user lane, `hash` does not. Equal refs that differ only
   in user bits hash to different buckets. The bundler keeps `Ref`s as
   `ArrayHashMap<Ref, _>` keys in at least 6 places (RefImportData,
   ChunkMetaMap, exports_to_other_chunks, ChunkMetaMap, …). The in-source
   comment at lines 393-397 **explicitly notes the risk** and asserts callers
   normalize via `without_user_bits()` before lookup — but the type-level invariant
   is not enforced, and any new caller that forgets the normalization will
   experience a silent map miss. Not UB, but a correctness landmine.

2. **F-L-2 — `StableRef` Ord/Eq inconsistency** (`src/bundler/ungate_support.rs:107-129`).
   `cmp(a, b) == Equal` does not imply `a == b`. Today's only sort site
   uses `sort_unstable_by(is_less_than)` and avoids the bug; any future use of
   `sort_unstable()`, `BTreeMap<StableRef, _>`, `binary_search`, or
   `[T]::dedup()` will silently misbehave. The fix is mechanical: extend `cmp`
   to break ties on the remaining `Ref` bits (`tag`, `source_index`) so it
   matches `eq`.

3. **F-L-3 — `EffectiveUrlContext` collision-as-equality** (`src/runtime/bake/FrameworkRouter.rs:466-473`).
   `eql(a, b)` returns `a.effective_url_hash() == b.effective_url_hash()`. The
   comparator is supposed to be a fallback when the bucket hash collides, but
   here the comparator *is* the hash. Two distinct dynamic routes whose 64-bit
   `effective_url_hash` collides will silently overwrite each other in
   `DynamicRouteMap`. Adversarial input (crafted URLs to collide wyhash-64) can
   force route impersonation. Not UB; routing-table correctness bug.

---

## What's *not* in this bucket (closed without finding)

- **No custom `Hasher` impls** in `src/`. `bun_wyhash::OneShotHasher` is the
  only project-local hasher and its `write_*` methods are pure folds with no
  panic paths (audited at `src/wyhash/lib.rs`). `Hasher::write` panic-safety
  is **N/A** for Bun.
- **No `TrustedLen` impls** anywhere in workspace. The `ExactSizeIterator`
  honesty quibbles in F-L-5 are not soundness issues.
- **No `Iterator` that returns `unsafe`-marked items**. All custom iterators
  yield `&T` / `&mut T` / `T` derived from already-bounds-checked indices.
- **No custom `Allocator` returning unaligned or oversized pointers**.
  `bun_alloc`'s five impls are all thin forwarders to mimalloc or `Global`.
- **No `Hash`-keyed `HashMap` with `RandomState` collision-attack surface**.
  The bundler / parser / printer use `bun_wyhash::BuildHasher` (deterministic
  wyhash, not randomized) — that's a separate
  DoS-surface concern (Bucket 18: DoS), not a Bucket 12 soundness concern.
- **No `Eq` over float fields without `OrderedFloat` discipline**. All custom
  `PartialEq` impls audited operate over integers, pointers, or byte slices.

---

## Severity ladder

| ID  | severity | UB? | action |
|-----|----------|-----|--------|
| EXP-014 | CONFIRMED_UB | yes | already in registry; remediation tracked under Bucket 1 |
| F-L-1 | CORRECTNESS_DRIFT | no | file beads: enforce identity-only `Hash` impl on `Ref` (use `self.without_user_bits().0.hash(state)`) — single-line fix, no behavior change for properly-normalized callers |
| F-L-2 | CORRECTNESS_DRIFT | no | file beads: extend `StableRef::cmp` to break ties on remaining `Ref` bits — single-line fix |
| F-L-3 | CORRECTNESS_DRIFT | no | file beads: compare canonical-form bytes (not hash) in `EffectiveUrlContext::eql` — requires holding the canonical form; revisit design |
| F-L-4 | CORRECTNESS_DRIFT | no | **no action** — legal direction of Hash/Eq drift, matches Zig original |
| F-L-5 | CORRECTNESS_DRIFT | no | **no action** — ExactSizeIterator is a safe trait; no TrustedLen consumers |
| F-L-6 | DEFENSIBLE | no | document mimalloc version dependency; **no action** |
| F-L-7 | DEFENSIBLE | no | document; **no action** |
| F-L-8 | DEFENSIBLE | no | **no action** |
| F-L-9 | DEFENSIBLE | no | drift flows through this hasher into ArrayHashMap; fix at source (F-L-1) |

---

## Deliverable summary

- **Total custom Hash/Eq/Ord/Iterator/Allocator impls (in `src/`):** 36 PartialEq + 11 Eq + 4 Ord + 13 Iterator + 6 ExactSizeIterator + 5 Allocator + 1 GlobalAlloc + 2 dedicated Hash + 4 ArrayHashContext = ~80 sites audited.
- **Drift?** Yes — three correctness-class drifts (F-L-1, F-L-2, F-L-3) and one project-local trait drift already tracked under EXP-014. **Zero new soundness-class (UB) findings**: Bucket 12 in Bun is dominated by correctness drifts that std would forgive (silent miss / silent overwrite), not by UB. The single existing UB-class hit (`Slice<T>: Copy`) is already in the registry.
- **Top 3 finds:** see "Top 3 finds" section above — `Ref` Hash/Eq forward drift, `StableRef` Ord/Eq inconsistency, `EffectiveUrlContext` collision-as-equality.
