//! Core AST node payload types and arena-slice helpers.
#![allow(non_snake_case, dead_code, clippy::all)]

use core::fmt;
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

pub use bun_collections::VecExt as _VecExtReexport;
use bun_collections::{ArrayHashMap, MultiArrayList, StringHashMap};
use bun_core::Output;

use crate::JsonWriter;
use crate::char_freq::CHAR_FREQ_COUNT;
use crate::{Binding, E, Expr, Index, Ref, Scope, Stmt, symbol};

pub use crate::flags as Flags;

// ───────────────────────────────────────────────────────────────────────────
// StoreRef — arena-owned pointer into a node Store / bump arena.
//
// Thin `NonNull<T>` newtype — `Copy`, `Deref`/`DerefMut`. The pointee lives
// until the owning Store/arena is `reset()`; callers must not hold a `StoreRef`
// across that boundary. Matches Zig's `*T` payloads in `Expr.Data`.
// ───────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct StoreRef<T>(NonNull<T>);

// SAFETY: `StoreRef` is a thin pointer into a single-threaded bump arena (Zig
// `*T`). We assert Send/Sync so payload types embedding `Option<StoreRef<T>>`
// (e.g. `E::EString::next`) can sit in `static` tables — matches Zig where raw
// pointers carry no thread-affinity. Callers are responsible for not actually
// sharing a Store across threads (same contract as the Zig original).
//
// Bounded on `T` so `StoreRef` cannot launder a `!Send`/`!Sync` payload (e.g.
// `StoreRef<Cell<_>>`) past auto-trait inference: `Deref` yields `&T` (needs
// `T: Sync` to share), and a `Send`-moved `StoreRef` yields `&mut T` via
// `DerefMut` (needs `T: Send`).
unsafe impl<T: Send> Send for StoreRef<T> {}
unsafe impl<T: Sync> Sync for StoreRef<T> {}

impl<T> StoreRef<T> {
    #[inline]
    pub const fn from_non_null(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
    /// Wrap a raw pointer. Panics if `p` is null. Alignment and arena-lifetime
    /// are caller-tracked just like the already-safe `from_non_null` /
    /// `From<NonNull<T>>` constructors — the only invariant `unsafe` was
    /// guarding here was non-null, which we now check.
    #[inline]
    pub fn from_raw(p: *mut T) -> Self {
        StoreRef(NonNull::new(p).expect("StoreRef::from_raw: null pointer"))
    }
    /// Wrap a `bumpalo::Bump::alloc` result.
    #[inline]
    pub fn from_bump(r: &mut T) -> Self {
        StoreRef(NonNull::from(r))
    }
    /// Consume a `Box<T>` whose payload must outlive every Store reset
    /// (Zig `deepClone(default_allocator)` semantics). Ownership transfers to
    /// the returned `StoreRef`; the allocation is process-lifetime by design
    /// and is never dropped — mirrors `bun.default_allocator.create(T)` with
    /// no paired `destroy`. Prefer `from_bump` for arena-backed nodes.
    #[inline]
    pub fn from_box(b: Box<T>) -> Self {
        StoreRef(bun_core::heap::into_raw_nn(b))
    }
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    /// Wrap a `&'static T` (compile-time/global singleton — e.g. Prefill
    /// constants). Mutation through the resulting `StoreRef` is UB.
    #[inline]
    pub const fn from_static(r: &'static T) -> Self {
        // SAFETY: `r` is a non-null, aligned, dereferenceable `'static`
        // reference. Provenance is shared/read-only: this mirrors Zig
        // `@constCast` on prefill tables. The pointee is *never* written
        // through — `DerefMut` on a `StoreRef` produced here is UB and callers
        // must not do so (audited: only `Deref`/`get()` reads occur).
        StoreRef(unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) })
    }
    /// Borrow the pointee (explicit form of `Deref`).
    #[inline]
    pub fn get(&self) -> &T {
        self
    }
}
impl<T> Clone for StoreRef<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for StoreRef<T> {}
impl<T> Deref for StoreRef<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: StoreRef invariant — points into a live Store/arena block.
        unsafe { self.0.as_ref() }
    }
}
impl<T> DerefMut for StoreRef<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: StoreRef invariant. AST nodes are mutated in-place during
        // visiting; no two `StoreRef` to the same node are deref'd `&mut`
        // simultaneously in single-threaded parser/visitor passes — same
        // contract as the Zig original.
        unsafe { self.0.as_mut() }
    }
}
impl<T> From<NonNull<T>> for StoreRef<T> {
    #[inline]
    fn from(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
}
/// Pointer-identity comparison (matches the `NonNull<T>`/Zig `*T` semantics
/// of the field this type replaces).
impl<T> PartialEq for StoreRef<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl<T> Eq for StoreRef<T> {}

pub type ExprNodeIndex = Expr;
pub type StmtNodeIndex = Stmt;
pub type BindingNodeIndex = Binding;

// ─── arena-slice helpers ────────────────────────────────────────────────────
// Legacy alias: AST string fields now uniformly use `StoreStr` (safe `Deref`
// wrapper around an arena `[u8]`). Kept as a type alias so existing field
// declarations / call sites that spell `ArenaStr` continue to compile.
pub(crate) type ArenaStr = StoreStr;
#[inline]
pub(crate) const fn empty_arena_str() -> ArenaStr {
    StoreStr::EMPTY
}
// (former `empty_arena_slice_mut<T>()` removed — use `StoreSlice::<T>::EMPTY`.)

// ─── StoreStr — arena-owned string slice (StoreRef's [u8] sibling) ──────────
//
// AST string fields (`E::Dot.name`, `E::String.data`, …) borrow from the parse
// arena and are bulk-freed at `Store::reset()`. `StoreStr` mirrors
// `StoreRef<T>` (raw `NonNull<T>`) and `StmtNodeList` (`StoreSlice<Stmt>`): a
// thin lifetime-erased pointer with safe construction and `Deref<Target=[u8]>`
// under the same callers-must-not-outlive-the-arena contract that `StoreRef`
// already imposes. Avoids cascading `<'arena>` through `Expr`/`Stmt`/`Data`
// (~100 types, 12 downstream crates) — that cascade is the follow-up round
// once `StoreRef` itself carries `'arena`.
#[derive(Copy, Clone)]
#[repr(C)]
pub struct StoreStr {
    ptr: core::ptr::NonNull<u8>,
    len: usize,
}

// SAFETY: same rationale as `StoreRef` — points into a single-threaded bump
// arena (Zig `[]const u8`). Asserted Send/Sync so payload types can sit in
// `static` Prefill tables; callers must not actually share a Store across
// threads (unchanged contract).
unsafe impl Send for StoreStr {}
unsafe impl Sync for StoreStr {}

impl StoreStr {
    pub const EMPTY: StoreStr = StoreStr {
        ptr: core::ptr::NonNull::<u8>::dangling(),
        len: 0,
    };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[u8]) -> Self {
        match core::ptr::NonNull::new(s.as_ptr().cast_mut()) {
            Some(ptr) => StoreStr { ptr, len: s.len() },
            // Only the (ptr=null, len=0) empty-slice edge needs this; Rust
            // `&[u8]` never has a null ptr, but be defensive for const-eval.
            None => StoreStr::EMPTY,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const u8 {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> usize {
        self.len
    }

    /// Re-borrow as `&[u8]`. Same safety contract as `StoreRef::get`: the
    /// pointee lives until arena reset, which the caller must not cross.
    /// Takes `self` by value (it's `Copy`) so the returned borrow is not tied
    /// to a stack temporary — mirrors `StoreRef::Deref`'s arena contract.
    #[inline]
    pub fn slice<'a>(self) -> &'a [u8] {
        // SAFETY: StoreStr invariant — `ptr` is non-null, points at `len`
        // initialized bytes valid for the arena lifetime (or `'static`); caller
        // must not outlive the owning arena (same as `StoreRef`).
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }

    #[inline]
    pub fn as_raw(self) -> *const [u8] {
        core::ptr::slice_from_raw_parts(self.ptr.as_ptr(), self.len)
    }

    // (former `from_raw(*const [u8])` removed — the StoreSlice migration is
    // complete; `js_printer::renamer::NameStr` now constructs via the safe
    // `StoreStr::new(&[u8])`, so the raw-fat-pointer back-door has no
    // remaining callers.)
}

impl Default for StoreStr {
    #[inline]
    fn default() -> Self {
        StoreStr::EMPTY
    }
}

impl core::ops::Deref for StoreStr {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.slice()
    }
}

impl AsRef<[u8]> for StoreStr {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.slice()
    }
}
impl core::borrow::Borrow<[u8]> for StoreStr {
    #[inline]
    fn borrow(&self) -> &[u8] {
        self.slice()
    }
}

impl<const N: usize> From<&[u8; N]> for StoreStr {
    #[inline]
    fn from(s: &[u8; N]) -> Self {
        StoreStr::new(s)
    }
}
impl From<&[u8]> for StoreStr {
    #[inline]
    fn from(s: &[u8]) -> Self {
        StoreStr::new(s)
    }
}
impl From<&str> for StoreStr {
    #[inline]
    fn from(s: &str) -> Self {
        StoreStr::new(s.as_bytes())
    }
}

impl PartialEq for StoreStr {
    #[inline]
    fn eq(&self, other: &StoreStr) -> bool {
        self.slice() == other.slice()
    }
}
impl Eq for StoreStr {}
impl PartialEq<[u8]> for StoreStr {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.slice() == other
    }
}
impl<const N: usize> PartialEq<&[u8; N]> for StoreStr {
    #[inline]
    fn eq(&self, other: &&[u8; N]) -> bool {
        self.slice() == *other
    }
}
impl<const N: usize> PartialEq<[u8; N]> for StoreStr {
    #[inline]
    fn eq(&self, other: &[u8; N]) -> bool {
        self.slice() == other
    }
}
impl PartialEq<&[u8]> for StoreStr {
    #[inline]
    fn eq(&self, other: &&[u8]) -> bool {
        self.slice() == *other
    }
}
impl core::hash::Hash for StoreStr {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        self.slice().hash(h)
    }
}
impl core::fmt::Debug for StoreStr {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        bstr::BStr::new(self.slice()).fmt(f)
    }
}

// ─── StoreSlice<T> — arena-owned typed slice (StoreStr's generic sibling) ───
//
// Generalizes `StoreStr` to `[T]` for AST list fields (`E::Arrow.args`,
// per-node `[Stmt]`/`[Expr]` views, …) that borrow from the parse arena.
// Same contract as `StoreRef`/`StoreStr`: safe `::new`,
// raw `NonNull<T>` + `u32` length, `Deref<Target=[T]>`, valid until the
// owning arena resets. The `u32` length matches Zig's `[]T` (`u32` len under
// `-Dwasm32` and the AST's practical bounds) and keeps the field at 12 bytes
// on 64-bit instead of 16 — relevant for hot AST nodes.
#[repr(C)]
pub struct StoreSlice<T> {
    ptr: core::ptr::NonNull<T>,
    len: u32,
}

// Manual Copy/Clone: derive would add a spurious `T: Copy` bound.
impl<T> Copy for StoreSlice<T> {}
impl<T> Clone for StoreSlice<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

// SAFETY: same rationale as `StoreStr` — points into a single-threaded bump
// arena. Asserted Send/Sync so payload types can sit in `static` Prefill
// tables; callers must not actually share a Store across threads.
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}

impl<T> StoreSlice<T> {
    pub const EMPTY: StoreSlice<T> = StoreSlice {
        ptr: core::ptr::NonNull::<T>::dangling(),
        len: 0,
    };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        match core::ptr::NonNull::new(s.as_ptr().cast_mut()) {
            Some(ptr) => StoreSlice {
                ptr,
                len: s.len() as u32,
            },
            None => StoreSlice::EMPTY,
        }
    }

    /// Wrap an arena-owned mutable slice (e.g. `bump.alloc_slice_*`). Same
    /// contract as `new`; provided so callers don't need a `&mut → &` reborrow
    /// at every site.
    #[inline]
    pub fn new_mut(s: &mut [T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        match core::ptr::NonNull::new(s.as_mut_ptr()) {
            Some(ptr) => StoreSlice {
                ptr,
                len: s.len() as u32,
            },
            None => StoreSlice::EMPTY,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const T {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> u32 {
        self.len
    }

    /// Re-borrow as `&[T]`. Same safety contract as `StoreStr::slice` /
    /// `StoreRef::get`: the pointee lives until arena reset, which the caller
    /// must not cross. Takes `self` by value (Copy) so the returned borrow is
    /// not tied to a stack temporary.
    #[inline]
    pub fn slice<'a>(self) -> &'a [T] {
        // SAFETY: StoreSlice invariant — `ptr` is non-null, points at `len`
        // initialized `T` valid for the arena lifetime (or `'static`); caller
        // must not outlive the owning arena (same as `StoreRef`).
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Re-borrow as `&mut [T]`. Same `StoreRef` contract as [`slice`]: the
    /// pointee lives until arena reset, and the single-threaded parser/visitor
    /// pass holds at most one live `&mut` per node (mirrors `StoreRef`'s safe
    /// `DerefMut`, which already encodes this invariant). The arena hands out
    /// unique allocations and `StoreSlice` is `Copy`, so aliasing cannot be
    /// *statically* checked — but neither can `StoreRef::deref_mut`'s, and the
    /// two share one safety story. Callers must not overlap a `slice_mut()`
    /// borrow with another `slice()`/`slice_mut()` of the same allocation.
    #[inline]
    pub fn slice_mut<'a>(self) -> &'a mut [T] {
        // SAFETY: StoreSlice invariant — `ptr` is non-null, points at `len`
        // initialized `T` valid for the arena lifetime; uniqueness is upheld
        // by the single-threaded visitor contract (same as `StoreRef::DerefMut`).
        unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Shorten the slice in place. Panics if `new_len > len` (mirrors Zig
    /// `slice[0..new_len]` bounds check). The arena still owns the trailing
    /// elements; they are simply no longer reachable through this view.
    #[inline]
    pub fn truncate(&mut self, new_len: usize) {
        assert!(new_len <= self.len as usize);
        self.len = new_len as u32;
    }

    /// Construct from a `BumpVec`/`ArenaVec` by leaking it into the bump arena
    /// (Zig: `list.items` after `toOwnedSlice`). Convenience for the common
    /// `StoreSlice::new_mut(v.into_bump_slice_mut())` pattern.
    #[inline]
    pub fn from_bump<'b>(v: bun_alloc::ArenaVec<'b, T>) -> Self {
        use bun_alloc::ArenaVecExt as _;
        StoreSlice::new_mut(v.into_bump_slice_mut())
    }
}

impl<'a, T> From<bun_alloc::ArenaVec<'a, T>> for StoreSlice<T> {
    #[inline]
    fn from(v: bun_alloc::ArenaVec<'a, T>) -> Self {
        StoreSlice::from_bump(v)
    }
}

impl<T> Default for StoreSlice<T> {
    #[inline]
    fn default() -> Self {
        StoreSlice::EMPTY
    }
}

impl<T> core::ops::Deref for StoreSlice<T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> AsRef<[T]> for StoreSlice<T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> From<&[T]> for StoreSlice<T> {
    #[inline]
    fn from(s: &[T]) -> Self {
        StoreSlice::new(s)
    }
}
impl<T> From<&mut [T]> for StoreSlice<T> {
    #[inline]
    fn from(s: &mut [T]) -> Self {
        StoreSlice::new_mut(s)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for StoreSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.slice().fmt(f)
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/// This is the index to the automatically-generated part containing code that
/// calls "__export(exports, { ... getters ... })". This is used to generate
/// getters on an exports object for ES6 export statements, and is both for
/// ES6 star imports and CommonJS-style modules. All files have one of these,
/// although it may contain no statements if there is nothing to export.
pub const NAMESPACE_EXPORT_PART_INDEX: u32 = 0;

// There are three types.
// 1. Expr (expression)
// 2. Stmt (statement)
// 3. Binding
// Q: "What's the difference between an expression and a statement?"
// A:  > Expression: Something which evaluates to a value. Example: 1+2/x
//     > Statement: A line of code which does something. Example: GOTO 100
//     > https://stackoverflow.com/questions/19132/expression-versus-statement/19224#19224

// Expr, Binding, and Stmt each wrap a Data:
// Data is where the actual data where the node lives.
// There are four possible versions of this structure:
// [ ] 1.  *Expr, *Stmt, *Binding
// [ ] 1a. *Expr, *Stmt, *Binding something something dynamic dispatch
// [ ] 2.  *Data
// [x] 3.  Data.(*) (The union value in Data is a pointer)
// I chose #3 mostly for code simplification -- sometimes, the data is modified in-place.
// But also it uses the least memory.
// Since Data is a union, the size in bytes of Data is the max of all types
// So with #1 or #2, if S.Function consumes 768 bits, that means Data must be >= 768 bits
// Which means "true" in code now takes up over 768 bits, probably more than what v8 spends
// Instead, this approach means Data is the size of a pointer.
// It's not really clear which approach is best without benchmarking it.
// The downside with this approach is potentially worse memory locality, since the data for the node is somewhere else.
// But it could also be better memory locality due to smaller in-memory size (more likely to hit the cache)
// only benchmarks will provide an answer!
// But we must have pointers somewhere in here because can't have types that contain themselves

/// Slice that stores capacity and length in the same space as a regular slice.
pub type ExprNodeList = Vec<Expr, bun_alloc::AstAlloc>;

// Arena-owned `[Stmt]` / `[Binding]` views — see `StoreSlice<T>` doc above.
// A `PhantomData<&'arena ()>` can be added to `StoreSlice` later as a
// one-struct change once `'arena` is threaded through `Expr`/`Stmt`/`Data`.
pub type StmtNodeList = StoreSlice<Stmt>;
pub type BindingNodeList = StoreSlice<Binding>;

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ImportItemStatus {
    None,
    /// The linker doesn't report import/export mismatch errors
    Generated,
    /// The printer will replace this import with "undefined"
    Missing,
}

impl ImportItemStatus {
    // TODO(port): narrow error set
    pub fn json_stringify(
        self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum AssignTarget {
    #[default]
    None = 0,
    /// "a = b"
    Replace = 1,
    /// "a += b"
    Update = 2,
}

impl AssignTarget {
    // TODO(port): narrow error set
    pub fn json_stringify(
        &self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(*self))
    }
}

#[derive(Copy, Clone)]
pub struct LocRef {
    pub loc: crate::Loc,

    // TODO: remove this optional and make Ref a function getter
    // That will make this struct 128 bits instead of 192 bits and we can remove some heap allocations
    pub ref_: Option<Ref>,
}

impl Default for LocRef {
    fn default() -> Self {
        Self {
            loc: crate::Loc::EMPTY,
            ref_: None,
        }
    }
}

pub struct ClauseItem {
    /// The local alias used for the imported/exported symbol in the current module.
    /// For imports: `import { foo as bar }` - "bar" is the alias
    /// For exports: `export { foo as bar }` - "bar" is the alias
    /// For re-exports: `export { foo as bar } from 'path'` - "bar" is the alias
    pub alias: ArenaStr,
    pub alias_loc: crate::Loc,
    /// Reference to the actual symbol being imported/exported.
    /// For imports: `import { foo as bar }` - ref to the symbol representing "foo" from the source module
    /// For exports: `export { foo as bar }` - ref to the local symbol "foo"
    /// For re-exports: `export { foo as bar } from 'path'` - ref to an intermediate symbol
    pub name: LocRef,

    /// This is the original name of the symbol stored in "Name". It's needed for
    /// "SExportClause" statements such as this:
    ///
    ///   export {foo as bar} from 'path'
    ///
    /// In this case both "foo" and "bar" are aliases because it's a re-export.
    /// We need to preserve both aliases in case the symbol is renamed. In this
    /// example, "foo" is "OriginalName" and "bar" is "Alias".
    pub original_name: ArenaStr,
}

impl ClauseItem {
    pub const DEFAULT_ALIAS: &'static [u8] = b"default";
}

impl Default for ClauseItem {
    fn default() -> Self {
        Self {
            alias: empty_arena_str(),
            alias_loc: crate::Loc::EMPTY,
            name: LocRef::default(),
            original_name: empty_arena_str(),
        }
    }
}

#[derive(Clone)]
pub struct SlotCounts {
    pub slots: symbol::SlotNamespaceCountsArray,
}

impl Default for SlotCounts {
    fn default() -> Self {
        // EnumMap<_, u32>::default() zero-fills (Zig: SlotNamespace.CountsArray.initFill(0)).
        Self {
            slots: symbol::SlotNamespaceCountsArray::default(),
        }
    }
}

impl SlotCounts {
    pub fn union_max(&mut self, other: SlotCounts) {
        // TODO(port): `enum_map::EnumMap` exposes `.values()`; the Zig iterates raw arrays.
        for (a, b) in self.slots.values_mut().zip(other.slots.values()) {
            if *a < *b {
                *a = *b;
            }
        }
    }
}

pub struct NameMinifier {
    pub head: Vec<u8>,
    pub tail: Vec<u8>,
}

impl NameMinifier {
    pub const DEFAULT_HEAD: &'static [u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub const DEFAULT_TAIL: &'static [u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

    pub fn init() -> NameMinifier {
        NameMinifier {
            head: Vec::new(),
            tail: Vec::new(),
        }
    }

    pub fn number_to_minified_name(
        &self,
        name: &mut Vec<u8>,
        i_: isize,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        name.clear();
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).expect("int cast");
        name.extend_from_slice(&self.head[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).expect("int cast");
            name.extend_from_slice(&self.tail[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }
        Ok(())
    }

    pub fn default_number_to_minified_name(
        i_: isize,
    ) -> core::result::Result<Vec<u8>, bun_alloc::AllocError> {
        let mut i = i_;
        let mut j = usize::try_from(i.rem_euclid(54)).expect("int cast");
        let mut name: Vec<u8> = Vec::new();
        name.extend_from_slice(&Self::DEFAULT_HEAD[j..j + 1]);
        i = i.div_euclid(54);

        while i > 0 {
            i -= 1;
            j = usize::try_from(i.rem_euclid(CHAR_FREQ_COUNT as isize)).expect("int cast");
            name.extend_from_slice(&Self::DEFAULT_TAIL[j..j + 1]);
            i = i.div_euclid(CHAR_FREQ_COUNT as isize);
        }

        Ok(name)
    }
}

#[repr(u8)] // Zig: enum(u1)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum OptionalChain {
    /// "a?.b"
    Start,

    /// "a?.b.c" => ".c" is OptionalChain::Continuation
    /// "(a?.b).c" => ".c" is None
    Continuation,
}

impl OptionalChain {
    // TODO(port): narrow error set
    pub fn json_stringify(
        self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub struct EnumValue {
    pub loc: crate::Loc,
    pub ref_: Ref,
    pub name: ArenaStr,
    pub value: Option<ExprNodeIndex>,
}

impl EnumValue {
    pub fn name_as_e_string(&self, bump: &bun_alloc::Arena) -> E::String {
        E::String::init_re_encode_utf8(self.name.slice(), bump)
    }
}

pub struct Catch {
    pub loc: crate::Loc,
    pub binding: Option<BindingNodeIndex>,
    pub body: StmtNodeList,
    pub body_loc: crate::Loc,
}

pub struct Finally {
    pub loc: crate::Loc,
    pub stmts: StmtNodeList,
}

pub struct Case {
    pub loc: crate::Loc,
    pub value: Option<ExprNodeIndex>,
    pub body: StmtNodeList,
}

pub struct ArrayBinding {
    pub binding: BindingNodeIndex,
    pub default_value: Option<ExprNodeIndex>,
}

/// TLA => Top Level Await
#[derive(Copy, Clone)]
pub struct TlaCheck {
    pub depth: u32,
    pub parent: crate::base::IndexInt,
    pub import_record_index: crate::base::IndexInt,
}

impl Default for TlaCheck {
    fn default() -> Self {
        Self {
            depth: 0,
            parent: Index::INVALID.get(),
            import_record_index: Index::INVALID.get(),
        }
    }
}

#[derive(Copy, Clone)]
pub struct Span {
    pub text: ArenaStr,
    pub range: crate::Range,
}

impl Default for Span {
    fn default() -> Self {
        Self {
            text: empty_arena_str(),
            range: crate::Range::default(),
        }
    }
}

/// Inlined enum values can only be numbers and strings
/// This type special cases an encoding similar to JSValue, where nan-boxing is used
/// to encode both a 64-bit pointer or a 64-bit float using 64 bits.
#[derive(Copy, Clone)]
pub struct InlinedEnumValue {
    pub raw_data: u64,
}

#[derive(Copy, Clone)]
pub enum InlinedEnumValueDecoded {
    // LIFETIMES.tsv: ARENA → *const e::String
    String(*const E::String),
    Number(f64),
}

impl InlinedEnumValue {
    /// See JSCJSValue.h in WebKit for more details
    const DOUBLE_ENCODE_OFFSET: u64 = 1 << 49;
    /// See PureNaN.h in WebKit for more details
    const PURE_NAN: f64 = f64::from_bits(0x7ff8000000000000);

    fn purify_nan(value: f64) -> f64 {
        if value.is_nan() {
            Self::PURE_NAN
        } else {
            value
        }
    }

    pub fn encode(decoded: InlinedEnumValueDecoded) -> InlinedEnumValue {
        let encoded = InlinedEnumValue {
            raw_data: match decoded {
                InlinedEnumValueDecoded::String(ptr) => {
                    (ptr as usize as u64) & 0x0000_FFFF_FFFF_FFFF
                } // @truncate to u48
                InlinedEnumValueDecoded::Number(num) => {
                    Self::purify_nan(num).to_bits() + Self::DOUBLE_ENCODE_OFFSET
                }
            },
        };
        if cfg!(debug_assertions) {
            debug_assert!(match encoded.decode() {
                InlinedEnumValueDecoded::String(str_) => match decoded {
                    InlinedEnumValueDecoded::String(orig) => core::ptr::eq(str_, orig),
                    _ => false,
                },
                InlinedEnumValueDecoded::Number(num) => match decoded {
                    InlinedEnumValueDecoded::Number(orig) =>
                        num.to_bits() == Self::purify_nan(orig).to_bits(),
                    _ => false,
                },
            });
        }
        encoded
    }

    pub fn decode(self) -> InlinedEnumValueDecoded {
        if self.raw_data > 0x0000_FFFF_FFFF_FFFF {
            InlinedEnumValueDecoded::Number(f64::from_bits(
                self.raw_data - Self::DOUBLE_ENCODE_OFFSET,
            ))
        } else {
            // SAFETY: encoded from a valid arena `*const E::String` (see `encode`); low 48 bits hold the address.
            InlinedEnumValueDecoded::String(self.raw_data as usize as *const E::String)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ExportsKind {
    // This file doesn't have any kind of export, so it's impossible to say what
    // kind of file this is. An empty file is in this category, for example.
    None,

    // The exports are stored on "module" and/or "exports". Calling "require()"
    // on this module returns "module.exports". All imports to this module are
    // allowed but may return undefined.
    Cjs,

    // All export names are known explicitly. Calling "require()" on this module
    // generates an exports object (stored in "exports") with getters for the
    // export names. Named imports to this module are only allowed if they are
    // in the set of export names.
    Esm,

    // Some export names are known explicitly, but others fall back to a dynamic
    // run-time object. This is necessary when using the "export * from" syntax
    // with either a CommonJS module or an external module (i.e. a module whose
    // export names are not known at compile-time).
    //
    // Calling "require()" on this module generates an exports object (stored in
    // "exports") with getters for the export names. All named imports to this
    // module are allowed. Direct named imports reference the corresponding export
    // directly. Other imports go through property accesses on "exports".
    EsmWithDynamicFallback,

    // Like "EsmWithDynamicFallback", but the module was originally a CommonJS
    // module.
    EsmWithDynamicFallbackFromCjs,
}

impl ExportsKind {
    pub fn is_dynamic(self) -> bool {
        matches!(
            self,
            Self::Cjs | Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs
        )
    }

    pub fn is_esm_with_dynamic_fallback(self) -> bool {
        matches!(
            self,
            Self::EsmWithDynamicFallback | Self::EsmWithDynamicFallbackFromCjs
        )
    }

    // TODO(port): narrow error set
    pub fn json_stringify(
        self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }

    // `to_module_type()` lives in `bun_options_types` as
    // `impl From<ExportsKind> for ModuleType` (would cycle here).
}

#[derive(Copy, Clone)]
pub struct DeclaredSymbol {
    pub ref_: Ref,
    pub is_top_level: bool,
}

pub struct DeclaredSymbolList {
    pub entries: MultiArrayList<DeclaredSymbol>,
}

impl Default for DeclaredSymbolList {
    fn default() -> Self {
        Self {
            entries: MultiArrayList::default(),
        }
    }
}

impl DeclaredSymbolList {
    pub fn refs(&self) -> &[Ref] {
        self.entries.items::<"ref_", Ref>()
    }

    pub fn to_owned_slice(&mut self) -> DeclaredSymbolList {
        core::mem::take(self)
    }

    pub fn clone(&self) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        Ok(DeclaredSymbolList {
            entries: self.entries.clone()?,
        })
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn append(
        &mut self,
        entry: DeclaredSymbol,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(entry);
        Ok(())
    }

    pub fn append_list(
        &mut self,
        other: DeclaredSymbolList,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(other.len())?;
        self.append_list_assume_capacity(other);
        Ok(())
    }

    pub fn append_list_assume_capacity(&mut self, other: DeclaredSymbolList) {
        // PERF(port): was assume_capacity
        self.entries.append_list_assume_capacity(&other.entries);
    }

    pub fn append_assume_capacity(&mut self, entry: DeclaredSymbol) {
        // PERF(port): was assume_capacity
        self.entries.append_assume_capacity(entry);
    }

    pub fn ensure_total_capacity(
        &mut self,
        count: usize,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_total_capacity(count)
    }

    pub fn ensure_unused_capacity(
        &mut self,
        count: usize,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        self.entries.ensure_unused_capacity(count)
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.entries.clear_retaining_capacity();
    }

    // `deinit` → Drop on MultiArrayList; no explicit body needed.

    pub fn init_capacity(
        capacity: usize,
    ) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut entries = MultiArrayList::<DeclaredSymbol>::default();
        entries.ensure_unused_capacity(capacity)?;
        Ok(DeclaredSymbolList { entries })
    }

    pub fn from_slice(
        entries: &[DeclaredSymbol],
    ) -> core::result::Result<DeclaredSymbolList, bun_alloc::AllocError> {
        let mut this = Self::init_capacity(entries.len())?;
        // errdefer this.deinit() → Drop handles it
        for entry in entries {
            this.append_assume_capacity(*entry);
        }
        Ok(this)
    }
}
// TODO(port): arena threading — Zig passes `std.mem.Allocator` to every
// MultiArrayList op. bun_collections::MultiArrayList owns its arena (global
// mimalloc); if Phase B needs arena-backed SoA storage, add a `&'bump Bump`
// param here.

impl DeclaredSymbol {
    fn for_each_top_level_symbol_with_type<C>(
        decls: &DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        let entries = decls.entries.slice();
        let is_top_level: &[bool] = entries.items::<"is_top_level", bool>();
        let refs: &[Ref] = entries.items::<"ref_", Ref>();

        // TODO: SIMD
        debug_assert_eq!(is_top_level.len(), refs.len());
        for (top, ref_) in is_top_level.iter().zip(refs.iter()) {
            if *top {
                // PERF(port): was @call(bun.callmod_inline, ...) — relies on inlining.
                f(ctx, *ref_);
            }
        }
    }

    pub fn for_each_top_level_symbol<C>(
        decls: &DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        Self::for_each_top_level_symbol_with_type(decls, ctx, f);
    }
}

#[derive(Copy, Clone)]
pub struct Dependency {
    pub source_index: Index,
    pub part_index: u32, // Index.Int
}

impl Default for Dependency {
    fn default() -> Self {
        Self {
            source_index: Index::INVALID,
            part_index: 0,
        }
    }
}

pub type DependencyList = Vec<Dependency>;

pub type ExprList = Vec<Expr>;
pub type StmtList = Vec<Stmt>;
pub type BindingList = Vec<Binding>;
// PERF(port): Zig `std.array_list.Managed` — these may be arena-backed in
// callers; revisit with bumpalo::collections::Vec if profiling shows churn.

/// Each file is made up of multiple parts, and each part consists of one or
/// more top-level statements. Parts are used for tree shaking and code
/// splitting analysis. Individual parts of a file can be discarded by tree
/// shaking and can be assigned to separate chunks (i.e. output files) by code
/// splitting.
pub struct Part {
    pub stmts: StoreSlice<Stmt>,
    pub scopes: StoreSlice<*mut Scope>, // TODO(port): &'bump mut [&'bump mut Scope]

    /// Each is an index into the file-level import record list
    pub import_record_indices: PartImportRecordIndices,

    /// All symbols that are declared in this part. Note that a given symbol may
    /// have multiple declarations, and so may end up being declared in multiple
    /// parts (e.g. multiple "var" declarations with the same name). Also note
    /// that this list isn't deduplicated and may contain duplicates.
    pub declared_symbols: DeclaredSymbolList,

    /// An estimate of the number of uses of all symbols used within this part.
    pub symbol_uses: PartSymbolUseMap,

    /// This tracks property accesses off of imported symbols. We don't know
    /// during parsing if an imported symbol is going to be an inlined enum
    /// value or not. This is only known during linking. So we defer adding
    /// a dependency on these imported symbols until we know whether the
    /// property access is an inlined enum value or not.
    pub import_symbol_property_uses: PartSymbolPropertyUseMap,

    /// The indices of the other parts in this file that are needed if this part
    /// is needed.
    pub dependencies: DependencyList,

    /// If true, this part can be removed if none of the declared symbols are
    /// used. If the file containing this part is imported, then all parts that
    /// don't have this flag enabled must be included.
    pub can_be_removed_if_unused: bool,

    /// This is used for generated parts that we don't want to be present if they
    /// aren't needed. This enables tree shaking for these parts even if global
    /// tree shaking isn't enabled.
    pub force_tree_shaking: bool,

    /// This is true if this file has been marked as live by the tree shaking
    /// algorithm.
    pub is_live: bool,

    pub tag: PartTag,
}

pub type PartImportRecordIndices = Vec<u32>;
pub type PartList = Vec<Part>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PartTag {
    None,
    JsxImport,
    Runtime,
    CjsImports,
    ReactFastRefresh,
    DirnameFilename,
    BunTest,
    DeadDueToInlining,
    CommonjsNamedExport,
    ImportToConvertFromRequire,
}

// Zig: std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false)
// TODO(port): bun_collections::ArrayHashMap must accept a custom hasher ctx (RefHashCtx).
pub type PartSymbolUseMap = ArrayHashMap<Ref, symbol::Use>;
pub type PartSymbolPropertyUseMap = ArrayHashMap<Ref, StringHashMap<symbol::Use>>;

impl Default for Part {
    fn default() -> Self {
        Self {
            stmts: StoreSlice::EMPTY,
            scopes: StoreSlice::EMPTY,
            import_record_indices: PartImportRecordIndices::default(),
            declared_symbols: DeclaredSymbolList::default(),
            symbol_uses: PartSymbolUseMap::default(),
            import_symbol_property_uses: PartSymbolPropertyUseMap::default(),
            dependencies: DependencyList::default(),
            can_be_removed_if_unused: false,
            force_tree_shaking: false,
            is_live: false,
            tag: PartTag::None,
        }
    }
}

impl Part {
    // TODO(port): narrow error set
    pub fn json_stringify(
        &self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(self.stmts.slice())
    }
}

pub enum StmtOrExpr {
    Stmt(Stmt),
    Expr(Expr),
}

impl Default for StmtOrExpr {
    fn default() -> Self {
        StmtOrExpr::Expr(Expr::default())
    }
}

impl StmtOrExpr {
    pub fn to_expr(self) -> Expr {
        match self {
            StmtOrExpr::Expr(expr) => expr,
            StmtOrExpr::Stmt(stmt) => match stmt.data {
                crate::stmt::Data::SFunction(mut s) => {
                    // PORT NOTE: Zig moved `func.func` out by value; StoreRef arena
                    // slot is never individually dropped, so `take` (replace with
                    // Default) is the safe Rust equivalent.
                    let func = core::mem::take(&mut s.func);
                    Expr::init(E::Function { func }, stmt.loc)
                }
                crate::stmt::Data::SClass(mut s) => {
                    let class = core::mem::take(&mut s.class);
                    Expr::init::<E::Class>(class, stmt.loc)
                }
                other => Output::panic(format_args!(
                    "Unexpected statement type in default export: .{}",
                    <&'static str>::from(other.tag())
                )),
            },
        }
    }
}

pub struct NamedImport {
    /// Parts within this file that use this import
    pub local_parts_with_uses: Vec<u32>,

    /// The original export name from the source module being imported.
    /// Examples:
    /// - `import { foo } from 'module'` → alias = "foo"
    /// - `import { foo as bar } from 'module'` → alias = "foo" (original export name)
    /// - `import * as ns from 'module'` → alias_is_star = true, alias = ""
    /// This field is used by the bundler to match imports with their corresponding
    /// exports and for error reporting when imports can't be resolved.
    pub alias: Option<ArenaStr>,
    pub alias_loc: Option<crate::Loc>,
    pub namespace_ref: Option<Ref>,
    pub import_record_index: u32,

    /// If true, the alias refers to the entire export namespace object of a
    /// module. This is no longer represented as an alias called "*" because of
    /// the upcoming "Arbitrary module namespace identifier names" feature:
    /// https://github.com/tc39/ecma262/pull/2154
    pub alias_is_star: bool,

    /// It's useful to flag exported imports because if they are in a TypeScript
    /// file, we can't tell if they are a type or a value.
    pub is_exported: bool,
}

#[derive(Copy, Clone)]
pub struct NamedExport {
    pub ref_: Ref,
    pub alias_loc: crate::Loc,
}

#[repr(u8)] // Zig: enum(u4)
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum StrictModeKind {
    SloppyMode,
    ExplicitStrictMode,
    ImplicitStrictModeImport,
    ImplicitStrictModeExport,
    ImplicitStrictModeTopLevelAwait,
    ImplicitStrictModeClass,
}

impl StrictModeKind {
    // TODO(port): narrow error set
    pub fn json_stringify(
        self,
        writer: &mut impl JsonWriter,
    ) -> core::result::Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }
}

pub fn printmem(args: fmt::Arguments<'_>) {
    // `defer Output.flush()` → executes after print; emulate ordering explicitly.
    Output::init_test();
    Output::print(args);
    Output::flush();
}

// TODO(b1): `thiserror` not in this crate's deps; hand-roll Display/Error.
#[derive(Debug, Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ToJSError {
    #[strum(serialize = "Cannot convert argument type to JS")]
    CannotConvertArgumentTypeToJS,
    #[strum(serialize = "Cannot convert identifier to JS. Try a statically-known value")]
    CannotConvertIdentifierToJS,
    MacroError,
    OutOfMemory,
    JSError,
    JSTerminated,
}
bun_core::impl_tag_error!(ToJSError);

bun_core::named_error_set!(ToJSError);

/// Say you need to allocate a bunch of tiny arrays
/// You could just do separate allocations for each, but that is slow
/// With std.ArrayList, pointers invalidate on resize and that means it will crash.
/// So a better idea is to batch up your allocations into one larger allocation
/// and then just make all the arrays point to different parts of the larger allocation
pub struct Batcher<T> {
    pub head: StoreSlice<T>,
}

impl<T> Batcher<T> {
    pub fn init(
        bump: &bun_alloc::Arena,
        count: usize,
    ) -> core::result::Result<Self, bun_alloc::AllocError>
    where
        T: Default,
    {
        // TODO(port): bumpalo alloc_slice for uninit T — Zig `arena.alloc(Type, count)`.
        // PERF(port): Zig left the slice uninitialized; bumpalo requires Default fill.
        let all = bump.alloc_slice_fill_default(count);
        Ok(Self {
            head: StoreSlice::new_mut(all),
        })
    }

    pub fn done(&mut self) {
        debug_assert!(self.head.is_empty()); // count to init() was too large, overallocation
    }

    pub fn eat(&mut self, value: T) -> *mut T {
        // PORT NOTE: Zig source `@ptrCast(&this.head.eat1(value).ptr)` appears to
        // intend `this.eat1(value).ptr` cast to *T. Porting the apparent intent.
        self.eat1(value).as_ptr().cast_mut()
    }

    pub fn eat1(&mut self, value: T) -> StoreSlice<T> {
        // `head` has at least 1 element remaining (caller contract — Zig would
        // panic on bounds); `Batcher` holds the unique view of the allocation.
        let head = self.head.slice_mut();
        let (prev, rest) = head.split_at_mut(1);
        prev[0] = value;
        self.head = StoreSlice::new_mut(rest);
        StoreSlice::new_mut(prev)
    }

    pub fn next<const N: usize>(&mut self, values: [T; N]) -> StoreSlice<T> {
        // `head` has at least N elements remaining; see `eat1`.
        let head = self.head.slice_mut();
        let (prev, rest) = head.split_at_mut(N);
        for (dst, src) in prev.iter_mut().zip(values) {
            *dst = src;
        }
        self.head = StoreSlice::new_mut(rest);
        StoreSlice::new_mut(prev)
    }
}
// Zig: `pub fn NewBatcher(comptime Type: type) type` → Rust generic struct above.
pub type NewBatcher<T> = Batcher<T>;

// ═════════════════════════════════════════════════════════════════════════
// Symbols pulled DOWN from higher-tier
// crates so lower-tier callers (css, interchange, js_parser itself) can
// resolve them here without forming a cycle. Ground truth for each port is
// the named .zig file, NOT the sibling .rs (which may already forward-ref).
// ═════════════════════════════════════════════════════════════════════════

// ─── from bun_jsc::math (src/jsc/jsc.zig) ───────────────────────────────────
pub mod math {
    /// `Number.MAX_SAFE_INTEGER` (2^53 - 1)
    pub const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
    /// `Number.MIN_SAFE_INTEGER` (-(2^53 - 1))
    pub const MIN_SAFE_INTEGER: f64 = -9007199254740991.0;

    unsafe extern "C" {
        // Zig: `extern "c" fn Bun__JSC__operationMathPow(f64, f64) f64;`
        // Pure FFI (value-type args, no pointers, no errno) → no caller preconditions.
        safe fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64;
    }

    /// JSC-compatible `Math.pow` (matches WebKit's `operationMathPow` corner-case
    /// handling for NaN/±∞/±0 — `std::powf` differs on a handful of inputs).
    #[inline]
    pub fn pow(x: f64, y: f64) -> f64 {
        Bun__JSC__operationMathPow(x, y)
    }
}
// ─── from bun_bundler::v2::MangledProps (src/bundler/bundle_v2.zig) ─────────
// Zig: `std.AutoArrayHashMapUnmanaged(Ref, []const u8)`
// LIFETIMES.tsv: value slices point into the parser arena → `StoreStr`
// (arena-owned, no `'bump` cascade).
pub type MangledProps = ArrayHashMap<Ref, StoreStr>;
