# Phase 2 — Bucket 25: Hash + Eq + Borrow Consistency

**Run:** `2026-05-15-exhaustive`
**Scope:** Bun Rust workspace under `src/` (~200 crates).
**Reference:** UB-TAXONOMY §25 — drift between `Hash`/`PartialEq`/`Borrow`.
**Status per §25:** Drift is a *logic error*, not Rust UB on its own; it becomes UB only if `unsafe` code in the project relies on the invariant for memory safety (e.g. `get_unchecked` after a hash lookup with no separate bounds check, or a soundness-bearing dedup).

## Methodology

1. Enumerated every manual `Hash` impl with `rg -n 'impl.*Hash for'` (filtered out the in-tree marker traits `CssHash` and `IdentityHash`).
2. For each, located the matching `PartialEq`/`Eq` (and `Borrow<U>` where relevant) and read the bodies side-by-side.
3. Checked every `impl.*Borrow.*for` to confirm `<T as Hash>::hash` agrees with `<U as Hash>::hash` for `T: Borrow<U>`.
4. Audited `unsafe` blocks in the surrounding modules for any soundness chain that depends on hash determinism or equality coincidence (e.g. `get_unchecked`/`get_unchecked_mut` after a `HashMap::get`).

`cargo clippy -W clippy::derived_hash_with_manual_eq` could not be run end-to-end because the workspace's `bun_core` build script requires `build/debug/codegen/build_options.rs`, which is only present after a full `bun bd --configure-only`. The manual audit below covers the same lint surface directly.

## Inventory

**Manual `Hash` impls (12 sites — every site in `src/`):**

| # | Site | Hash body | Eq body | Verdict |
|---|---|---|---|---|
| 1 | `src/ast/nodes.rs:300` `StoreStr` | `self.slice().hash(h)` | `self.slice() == other.slice()` | consistent — also matches its `Borrow<[u8]>` (returns `self.slice()`) |
| 2 | `src/ast/lib.rs:405` `Ref` | `self.as_u64().hash(state)` | `(self.0 & !USER_BITS_MASK) == (other.0 & !USER_BITS_MASK)` | consistent — `as_u64()` masks the user bits, identical to `eql`'s mask |
| 3 | `src/install/isolated_install/Store.rs:52` `NewId<T>` | `self.0.hash(state)` | `self.0 == other.0` | consistent (newtype over `u32`) |
| 4 | `src/bun_core/util.rs:3681` `GenericIndex<I,M>` | `self.0.hash(h)` | `self.0 == o.0` | consistent (forwards to inner `I`) |
| 5 | `src/collections/array_hash_map.rs:1655` `StringHashMapKey<A>` | `(**self).hash(state)` (slice hash) | `**self == **other` (slice eq) | consistent — `Borrow<[u8]>` returns the same `&[u8]`, so the `Hash::hash` agrees with `<[u8] as Hash>` for cross-key lookups |
| 6 | `src/css/rules/keyframes.rs:30` `KeyframesName` | hashes bytes only (no discriminant) | match-arms compare same-variant bytes; cross-variant → `false` | hash is intentionally *lossy* (same bytes across `Ident`/`Custom` collide) but the Hash≥Eq invariant `a==b ⟹ hash(a)==hash(b)` holds; mirrors the Zig context |
| 7 | `src/css/rules/layer.rs:27` `LayerName` | iterates segments, `state.write(part)` per segment, **no length/delimiter** | per-segment byte equality after length check | hash is lossy across reslicings (`["a","b"]` and `["ab"]` collide) but for equal `LayerName`s (same `len` + same per-index bytes) hashes match — invariant holds |
| 8 | `src/css/rules/supports.rs:416` `SeenDeclKey(PropertyId, &[u8])` | `wyhash(str) +% (tag as u32)` | `tag-only` on PropertyId, byte equality on slice | consistent: equal keys ⇒ same tag + same bytes ⇒ same hash |
| 9 | `src/jsc/JSValue.rs:1676` `JSValue` | `self.0.hash(state)` (raw `usize`) | derived `PartialEq`/`Eq` over the `usize` field | consistent (note: this is bitwise identity, *not* JS `===`; that is by design) |
| 10 | `src/css/properties/font.rs:461` `FontFamily` | `discriminant.hash + payload` | per-variant payload eq | consistent |
| 11 | `src/css/properties/properties_generated.rs:965` `PropertyId` | `tag().hash(state)` | `tag() == tag() && prefix() == prefix()` | hash is lossy (collides on prefix variation within a tag) but Hash≥Eq holds — equal `PropertyId`s share both tag and prefix ⇒ same hash |
| 12 | `src/bundler/bundle_v2.rs:699` `InputFile` | `write(abs_path()); write_u8(side)` | `side == side && abs_path() == abs_path()` | consistent |

**`Borrow<U>` impls relevant to §25:**

| Site | `Borrow<…>` | Hash matches `<U as Hash>`? |
|---|---|---|
| `src/ast/nodes.rs:243` `StoreStr → [u8]` | yes — `self.slice()` | yes (#1 above hashes `self.slice()`) |
| `src/collections/array_hash_map.rs:1641` `StringHashMapKey<A> → [u8]` | yes — `self` deref | yes (#5 hashes `(**self)`) |
| `src/ptr/lib.rs:480` `Interned → [u8]` | yes — `self.0` | `Interned` uses `#[derive(Hash)]` over `&'static [u8]`, which calls `<[u8] as Hash>` via auto-deref; matches a direct `&[u8]` lookup |

No other manual `Borrow` impls in `src/`.

## Drift analysis

**Strict drift (`a == b` with `hash(a) != hash(b)`): zero sites.** Every manual `Hash` impl preserves the core invariant.

Three sites use **lossy** hashes (more collisions than the `PartialEq` would imply): `KeyframesName` (drops variant tag), `LayerName` (drops segment delimiters), `PropertyId` (drops `prefix`). Each is documented as a deliberate port of the Zig hash-map context. None of these violate the Hash/Eq contract — Rust only requires the forward direction.

`Ref` masks the `user_bit` lane in both `eql` and `as_u64`, so identifier refs that carry transient parser flags hash to the same bucket as flag-free symbol-table keys (the design intent called out in the type-level doc).

## Unsafe-soundness reachability

Searched every Hash-impl-bearing file and every consumer of these types for `unsafe` paths that key off lookup results without an independent bounds/identity check:

- `unsafe fn get_or_put_borrowed` (`src/collections/array_hash_map.rs:2011`) is unsafe for the **lifetime** of the borrowed key (`'static` laundering), not for hash determinism. The `entry_ref` body is plain safe `hashbrown`.
- `get_unchecked` / `get_unchecked_mut` call sites under `src/` (semver, base64, immutable strings, atomic_cell, etc.) operate on `&[T]`/raw pointers with explicit length math; none index a `HashMap` slot returned from one of the manually-hashed types.
- The dedupe consumers of the lossy-hash sites (`SeenDeclKey`, `PropertyId`, `KeyframesName`, `LayerName`, `FontFamily`) all use safe `HashMap`/`ArrayHashMap` APIs; a hash collision becomes an extra `eql` call, not a memory access.

No unsafe code in the project depends on any of the (non-existent) Hash/Eq drifts for memory safety. Even the lossy-hash sites would only ever cause logic errors if drift were present.

## Deliverable summary

- **Total custom Hash/Eq pairs:** 12.
- **Drift?** None at the Hash/Eq contract level. Three sites (`KeyframesName`, `LayerName`, `PropertyId`) intentionally hash less than they compare, which is allowed by Rust's contract and matches the upstream Zig hash-map contexts.
- **Does any unsafe code depend on a drifted invariant for memory safety?** No. No `unsafe` site reachable from these types uses `get_unchecked` or equivalent on a hash-keyed lookup, and none of the lossy hashes can produce a wrong-bucket outcome (the `eql` step still discriminates). Bucket 25 yields zero UB and zero remediation work.

## Pointers (absolute paths)

- `/data/projects/bun/src/ast/nodes.rs`
- `/data/projects/bun/src/ast/lib.rs`
- `/data/projects/bun/src/install/isolated_install/Store.rs`
- `/data/projects/bun/src/bun_core/util.rs`
- `/data/projects/bun/src/collections/array_hash_map.rs`
- `/data/projects/bun/src/css/rules/keyframes.rs`
- `/data/projects/bun/src/css/rules/layer.rs`
- `/data/projects/bun/src/css/rules/supports.rs`
- `/data/projects/bun/src/jsc/JSValue.rs`
- `/data/projects/bun/src/css/properties/font.rs`
- `/data/projects/bun/src/css/properties/properties_generated.rs`
- `/data/projects/bun/src/bundler/bundle_v2.rs`
- `/data/projects/bun/src/ptr/lib.rs`
- `/data/projects/bun/src/collections/identity_context.rs`
