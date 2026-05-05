// Things that maybe should go in Zig standard library at some point
//
// PORT NOTE: This file is almost entirely comptime type reflection (`@typeInfo`,
// `@hasField`, `@hasDecl`, `std.meta.fields`, `bun.trait.*`) used to generically
// construct maps/arrays from heterogeneous inputs. Rust has no runtime/comptime
// type reflection; the idiomatic equivalents are the `From` / `FromIterator` /
// `Extend` traits, plus associated types for `Key`/`Value`/`Of`. The functions
// below preserve the Zig names and intent but delegate to traits that the
// concrete collection types (HashMap, Vec, MultiArrayList, BabyList) must impl.
// Phase B: audit call sites of `bun.from(...)` / `bun.fromEntries(...)` and
// likely replace them with direct `.collect()` / `Vec::from` at the caller.

use core::hash::Hash;

use bun_alloc::AllocError;
// TODO(b0): impls for bun_collections::{BabyList, HashMap, MultiArrayList} move to
// bun_collections (move-in pass) — orphan rule lets the higher-tier crate impl
// MapLike/ArrayLike for its own types.

// ─── Key / Value ──────────────────────────────────────────────────────────────
// Zig: `pub fn Key(comptime Map: type) type { return FieldType(Map.KV, "key").?; }`
// Zig: `pub fn Value(comptime Map: type) type { return FieldType(Map.KV, "value").?; }`
//
// Rust has no `fn -> type`; these become associated types on a trait that all
// map-like collections implement.
pub trait MapLike {
    type Key;
    type Value;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError>;
    fn put_assume_capacity(&mut self, key: Self::Key, value: Self::Value);
    fn put_assume_capacity_no_clobber(&mut self, key: Self::Key, value: Self::Value);
}

// Convenience aliases mirroring the Zig `Key(Map)` / `Value(Map)` call sites.
pub type Key<M> = <M as MapLike>::Key;
pub type Value<M> = <M as MapLike>::Value;

// ─── fromEntries ──────────────────────────────────────────────────────────────
// Zig dispatches on `@typeInfo(EntryType)`:
//   - indexable tuple/array of `[k, v]` pairs  → reserve + putAssumeCapacity
//   - container with `.count()` + `.iterator()` → reserve + iterate
//   - struct with fields                        → reserve(fields.len) + inline for
//   - *const struct with fields                 → same, deref'd
//   - else: @compileError
//
// In Rust the first two arms collapse to `IntoIterator<Item = (K, V)>` with an
// `ExactSizeIterator` bound for the reserve; the "struct fields as entries"
// arms have no equivalent (would need a derive) and are TODO'd.
pub fn from_entries<M, I>(entries: I) -> Result<M, AllocError>
where
    M: MapLike + Default,
    I: IntoIterator<Item = (M::Key, M::Value)>,
    I::IntoIter: ExactSizeIterator,
{
    // Zig: `if (@hasField(Map, "allocator")) Map.init(allocator) else Map{}`
    // Allocator param dropped (non-AST crate); both arms become `Default`.
    let mut map = M::default();

    let iter = entries.into_iter();

    // Zig: `try map.ensureUnusedCapacity([allocator,] entries.len)` — the
    // `needsAllocator` check vanishes because the allocator param is gone.
    map.ensure_unused_capacity(iter.len())?;

    for (k, v) in iter {
        // PERF(port): was putAssumeCapacity — profile in Phase B
        map.put_assume_capacity(k, v);
    }

    // TODO(port): the Zig `bun.trait.isContainer(EntryType) && fields.len > 0`
    // and `isConstPtr(EntryType) && fields(Child).len > 0` arms iterated *struct
    // fields* as entries (anonymous-struct-literal init). No Rust equivalent
    // without a proc-macro; callers should pass an array/iterator of tuples.

    Ok(map)
}

// ─── fromMapLike ──────────────────────────────────────────────────────────────
// Zig: takes `[]const struct { K, V }` and `putAssumeCapacityNoClobber`s each.
pub fn from_map_like<M>(entries: &[(M::Key, M::Value)]) -> Result<M, AllocError>
where
    M: MapLike + Default,
    M::Key: Clone,
    M::Value: Clone,
{
    // Zig: `if (@hasField(Map, "allocator")) Map.init(allocator) else Map{}`
    let mut map = M::default();

    map.ensure_unused_capacity(entries.len())?;

    for entry in entries {
        map.put_assume_capacity_no_clobber(entry.0.clone(), entry.1.clone());
    }

    Ok(map)
}

// ─── FieldType ────────────────────────────────────────────────────────────────
// Zig: `pub fn FieldType(comptime Map: type, comptime name: []const u8) ?type`
// TODO(port): no Rust equivalent for `std.meta.fieldIndex` / `.field_type`.
// Callers should use associated types (`MapLike::Key`, `ArrayLike::Elem`)
// directly. Left as a doc-only marker so cross-file grep finds it.
#[doc(hidden)]
pub enum FieldType {} // unconstructible; reflection placeholder

// ─── Of ───────────────────────────────────────────────────────────────────────
// Zig: element type of an array-like, probed via isSlice / @hasDecl("Elem") /
// @hasField("items") / @hasField("ptr").
//
// Rust: associated type on a trait the array-like containers implement.
pub trait ArrayLike {
    type Elem;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError>;
    fn append_assume_capacity(&mut self, elem: Self::Elem);
    /// Set `len` to `n` (caller has already reserved) and return the now-live
    /// slice for bulk memcpy. Mirrors the Zig `map.items.len = n; slice = map.items`.
    fn set_len_and_slice(&mut self, n: usize) -> &mut [Self::Elem];
}

pub type Of<A> = <A as ArrayLike>::Elem;

// ─── from ─────────────────────────────────────────────────────────────────────
// Zig: generic dispatcher that inspects `@TypeOf(default)` and routes to
// fromSlice / fromMapLike / fromEntries. The dispatch is pure comptime
// reflection on the *shape* of the input type.
//
// TODO(port): Rust cannot introspect "is this a slice / does it have .items /
// does it have .put". Phase B should delete this fn and have each call site
// call `from_slice` / `from_entries` / `from_map_like` directly (the caller
// always statically knows which one it wants). Kept as a thin slice-only
// forwarder so existing `bun.from(Array, alloc, &[...])` call sites compile.
#[inline]
pub fn from<A>(default: &[A::Elem]) -> Result<A, AllocError>
where
    A: ArrayLike + Default,
    A::Elem: Copy,
{
    from_slice(default)
}

// ─── fromSlice ────────────────────────────────────────────────────────────────
// Zig branches on the *target* type:
//   - MultiArrayList (`@hasField "bytes"`): reserve + appendAssumeCapacity loop
//   - ArrayList (`@hasField "items"`): reserve, set items.len, memcpy
//   - BabyList-ish (`@hasField "len"`): reserve, set len, memcpy
//   - raw slice: allocator.alloc + memcpy, return slice
//   - has `.ptr`: alloc + build `{ptr,len,cap}`
pub fn from_slice<A>(default: &[A::Elem]) -> Result<A, AllocError>
where
    A: ArrayLike + Default,
    A::Elem: Copy,
{
    // Zig: `if (isSlice) {} else if (@hasField "allocator") init(a) else Array{}`
    let mut map = A::default();

    // TODO(port): the Zig MultiArrayList arm (`@hasField(Array, "bytes")`)
    // appended element-by-element because SoA storage cannot be memcpy'd as one
    // block. The trait impl for `MultiArrayList<T>` must override
    // `set_len_and_slice` to panic and instead route through
    // `append_assume_capacity`. For now we take the memcpy path and rely on the
    // impl to do the right thing.

    map.ensure_unused_capacity(default.len())?;

    let slice = map.set_len_and_slice(default.len());

    // Zig: `@memcpy(out[0..in.len], in)` over `sliceAsBytes`
    slice.copy_from_slice(default);

    Ok(map)
}

/// The "target is a plain `[]T`" arm of Zig `fromSlice`: `allocator.alloc` +
/// memcpy + return the slice. In Rust this is just `Box<[T]>::from`.
pub fn from_slice_boxed<T: Copy>(default: &[T]) -> Box<[T]> {
    // Zig: `slice = try allocator.alloc(Of(Array), default.len); @memcpy(...)`
    Box::<[T]>::from(default)
}

// ─── needsAllocator ───────────────────────────────────────────────────────────
// Zig: `fn needsAllocator(comptime Fn: anytype) bool { ArgsTuple(Fn).len > 2 }`
// Used only to decide whether to pass `allocator` to `ensureUnusedCapacity`.
// Allocator params are dropped in Rust (non-AST crate), so this is dead.
// TODO(port): delete once all callers are migrated.
#[doc(hidden)]
#[inline(always)]
const fn needs_allocator() -> bool {
    false
}

// ─── trait impls for concrete collections ─────────────────────────────────────
// PORT NOTE: these did not exist in the Zig — they are the Rust replacement for
// the `@hasField` / `@hasDecl` probes. Impls for HashMap/BabyList/MultiArrayList
// live in `bun_collections` (move-in pass) to respect crate tiering.

impl<T> ArrayLike for Vec<T> {
    type Elem = T;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError> {
        self.reserve(additional);
        Ok(())
    }
    fn append_assume_capacity(&mut self, elem: T) {
        // PERF(port): was appendAssumeCapacity
        self.push(elem);
    }
    fn set_len_and_slice(&mut self, n: usize) -> &mut [T] {
        debug_assert!(self.capacity() >= n);
        // SAFETY: capacity reserved above; caller immediately memcpy-fills [0..n].
        // Matches Zig `map.items.len = default.len; slice = map.items;` which
        // also exposes uninitialized memory until the subsequent @memcpy.
        unsafe { self.set_len(n) };
        self.as_mut_slice()
    }
}

// TODO(b0): ArrayLike impls for BabyList<T> and MultiArrayList<T> arrive via
// move-in pass in bun_collections.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/util.zig (235 lines)
//   confidence: low
//   todos:      7
//   notes:      pure comptime-reflection helpers; mapped to MapLike/ArrayLike traits — Phase B should inline call sites to .collect()/Vec::from and likely delete this module
// ──────────────────────────────────────────────────────────────────────────
