//! Core AST node payload types and arena-slice helpers.
#![allow(non_snake_case)]

use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

pub use bun_collections::VecExt as _VecExtReexport;
use bun_collections::{ArrayHashMap, AutoContext, MultiArrayList, StringHashMap};
use bun_core::Output;

use crate::char_freq::CHAR_FREQ_COUNT;
use crate::{Binding, E, Expr, Index, Ref, Scope, Stmt, symbol};

pub use crate::flags as Flags;

// ───────────────────────────────────────────────────────────────────────────
// StoreRef — arena-owned pointer into a node Store / bump arena.
//
// Thin `NonNull<T>` newtype — `Copy`, `Deref`/`DerefMut`. The pointee lives
// until the owning Store/arena is `reset()`; callers must not hold a `StoreRef`
// across that boundary.
//
// `packed(4)` lowers the alignment to 4 without changing the single-scalar
// representation: still passed/returned in one register, `self.0` is one `mov`,
// and `Option<StoreRef<T>>` keeps its `NonNull` niche. The align-4 part is what
// lets `expr::Data`/`stmt::Data` drop to align 4 and `Expr`/`Stmt`/`Binding`
// pack into 16 bytes.
// ───────────────────────────────────────────────────────────────────────────

#[repr(C, packed(4))]
pub struct StoreRef<T>(NonNull<T>);

const _: () = assert!(core::mem::size_of::<StoreRef<u8>>() == 8);
const _: () = assert!(core::mem::align_of::<StoreRef<u8>>() == 4);
const _: () = assert!(core::mem::size_of::<Option<StoreRef<u8>>>() == 8);

// SAFETY: `StoreRef` is a thin pointer into a single-threaded bump arena.
// We assert Send/Sync so payload types embedding `Option<StoreRef<T>>`
// (e.g. `E::EString::next`) can sit in `static` tables. Callers are
// responsible for not actually sharing a Store across threads.
//
// Bounded on `T` so `StoreRef` cannot launder a `!Send`/`!Sync` payload (e.g.
// `StoreRef<Cell<_>>`) past auto-trait inference: `Deref` yields `&T` (needs
// `T: Sync` to share), and a `Send`-moved `StoreRef` yields `&mut T` via
// `DerefMut` (needs `T: Send`).
unsafe impl<T: Send> Send for StoreRef<T> {}
// SAFETY: see the `Send` impl above — same single-threaded bump-arena contract;
// bounded on `T: Sync` so the `Deref`-yielded `&T` is sound to share.
unsafe impl<T: Sync> Sync for StoreRef<T> {}

impl<T> StoreRef<T> {
    #[inline]
    pub(crate) const fn from_non_null(p: NonNull<T>) -> Self {
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
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    /// Wrap a `&'static T` (compile-time/global singleton — e.g. Prefill
    /// constants). Mutation through the resulting `StoreRef` is UB.
    #[inline]
    pub const fn from_static(r: &'static T) -> Self {
        // SAFETY: `r` is a non-null, aligned, dereferenceable `'static`
        // reference. Provenance is shared/read-only: the pointee is *never*
        // written through — `DerefMut` on a `StoreRef` produced here is UB and
        // callers must not do so (audited: only `Deref`/`get()` reads occur).
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
        unsafe { &*self.as_ptr() }
    }
}
impl<T> DerefMut for StoreRef<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: StoreRef invariant. AST nodes are mutated in-place during
        // visiting; no two `StoreRef` to the same node are deref'd `&mut`
        // simultaneously in single-threaded parser/visitor passes.
        unsafe { &mut *self.as_ptr() }
    }
}
impl<T> From<NonNull<T>> for StoreRef<T> {
    #[inline]
    fn from(p: NonNull<T>) -> Self {
        StoreRef::from_non_null(p)
    }
}
/// Pointer-identity comparison.
impl<T> PartialEq for StoreRef<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        // Copy out of the packed field before comparing (`NonNull::eq` takes
        // `&self`, which would require an unaligned reference).
        let (a, b) = (self.0, other.0);
        a == b
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
const fn empty_arena_str() -> ArenaStr {
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
// Layout matches `StoreSlice<u8>`: `packed(4)` lowers `NonNull<u8>` to align 4
// so the struct is 12 bytes instead of 16. The `u32` length keeps the 4 GB
// source-file limit explicit.
#[derive(Copy, Clone)]
#[repr(C, packed(4))]
pub struct StoreStr {
    ptr: NonNull<u8>,
    len: u32,
}

const _: () = assert!(core::mem::size_of::<StoreStr>() == 12);
const _: () = assert!(core::mem::align_of::<StoreStr>() == 4);

// SAFETY: same rationale as `StoreRef` — points into a single-threaded bump
// arena. Asserted Send/Sync so payload types can sit in
// `static` Prefill tables; callers must not actually share a Store across
// threads (unchanged contract).
unsafe impl Send for StoreStr {}
// SAFETY: see the `Send` impl above — `StoreStr` is a raw `(ptr, len)` into a
// single-threaded bump arena; never actually shared across threads.
unsafe impl Sync for StoreStr {}

impl StoreStr {
    pub const EMPTY: StoreStr = StoreStr {
        ptr: NonNull::<u8>::dangling(),
        len: 0,
    };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[u8]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        // SAFETY: `&[u8]` always has a non-null data pointer.
        let ptr = unsafe { NonNull::new_unchecked(s.as_ptr().cast_mut()) };
        StoreStr {
            ptr,
            len: s.len() as u32,
        }
    }

    #[inline]
    pub(crate) const fn as_ptr(self) -> *const u8 {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> usize {
        self.len as usize
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
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    #[inline]
    pub fn as_raw(self) -> *const [u8] {
        core::ptr::slice_from_raw_parts(self.ptr.as_ptr(), self.len as usize)
    }
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
// Same contract as `StoreRef`/`StoreStr`: safe `::new`, `Deref<Target=[T]>`,
// valid until the owning arena resets.
//
// Layout: `packed(4)` lowers `NonNull<T>` to align 4 so the field is 12 bytes
// instead of 16. The pointer stays a single scalar (one `mov` to read), and the
// `u32` length keeps the 4 G-element ceiling explicit.
#[repr(C, packed(4))]
pub struct StoreSlice<T> {
    ptr: NonNull<T>,
    len: u32,
}

const _: () = assert!(core::mem::size_of::<StoreSlice<u8>>() == 12);
const _: () = assert!(core::mem::align_of::<StoreSlice<u8>>() == 4);

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
// tables; callers must not actually share a Store across threads. Bounded on
// `T: Send` so the impl can't smuggle a non-`Send` payload across a thread
// boundary through the safe `slice()`/`Deref` accessors.
unsafe impl<T: Send> Send for StoreSlice<T> {}
// SAFETY: see the `Send` impl above — `StoreSlice` is a raw `(ptr, len)` into a
// single-threaded bump arena; never actually shared across threads. Bounded on
// `T: Sync` for the same reason `Send` is bounded on `T: Send`.
unsafe impl<T: Sync> Sync for StoreSlice<T> {}

impl<T> StoreSlice<T> {
    pub const EMPTY: StoreSlice<T> = StoreSlice {
        ptr: NonNull::<T>::dangling(),
        len: 0,
    };

    /// Wrap an arena-owned (or `'static`) slice. Safe: no lifetime is forged;
    /// the pointer is stored raw and re-borrowed under the `StoreRef` contract
    /// (valid until the owning arena resets).
    #[inline]
    pub const fn new(s: &[T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        // SAFETY: `&[T]` always has a non-null data pointer.
        let ptr = unsafe { NonNull::new_unchecked(s.as_ptr().cast_mut()) };
        StoreSlice {
            ptr,
            len: s.len() as u32,
        }
    }

    /// Wrap an arena-owned mutable slice (e.g. `bump.alloc_slice_*`). Same
    /// contract as `new`; provided so callers don't need a `&mut → &` reborrow
    /// at every site.
    #[inline]
    pub fn new_mut(s: &mut [T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        // SAFETY: `&mut [T]` always has a non-null data pointer.
        let ptr = unsafe { NonNull::new_unchecked(s.as_mut_ptr()) };
        StoreSlice {
            ptr,
            len: s.len() as u32,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const T {
        self.ptr.as_ptr()
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

    /// Shorten the slice in place. Panics if `new_len > len`.
    /// The arena still owns the trailing
    /// elements; they are simply no longer reachable through this view.
    #[inline]
    pub fn truncate(&mut self, new_len: usize) {
        assert!(new_len <= self.len as usize);
        self.len = new_len as u32;
    }

    /// Construct from a `BumpVec`/`ArenaVec` by leaking it into the bump arena.
    /// Convenience for the common
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

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ImportItemStatus {
    None,
    /// The linker doesn't report import/export mismatch errors
    Generated,
    /// The printer will replace this import with "undefined"
    Missing,
}

#[repr(u8)]
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

#[derive(Copy, Clone)]
pub struct LocRef {
    pub loc: crate::Loc,
    pub ref_: Ref,
}

const _: () = assert!(core::mem::size_of::<LocRef>() == 12);

impl Default for LocRef {
    fn default() -> Self {
        Self {
            loc: crate::Loc::EMPTY,
            ref_: Ref::NONE,
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

// EnumMap<_, u32>::default() zero-fills.
#[derive(Copy, Clone, Default)]
pub struct SlotCounts {
    pub slots: symbol::SlotNamespaceCountsArray,
}

impl SlotCounts {
    pub fn union_max(&mut self, other: SlotCounts) {
        for (a, b) in self.slots.values_mut().zip(other.slots.values()) {
            if *a < *b {
                *a = *b;
            }
        }
    }
}

pub struct NameMinifier {
    pub(crate) head: Vec<u8>,
    pub(crate) tail: Vec<u8>,
}

impl NameMinifier {
    pub(crate) const DEFAULT_HEAD: &'static [u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub(crate) const DEFAULT_TAIL: &'static [u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

    pub(crate) fn init() -> NameMinifier {
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

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum OptionalChain {
    /// "a?.b"
    Start,

    /// "a?.b.c" => ".c" is OptionalChain::Continuation
    /// "(a?.b).c" => ".c" is None
    Continuation,
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
    pub(crate) raw_data: u64,
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

    // `to_module_type()` lives in `bun_options_types` as
    // `impl From<ExportsKind> for ModuleType` (would cycle here).
}

#[derive(Copy, Clone)]
pub struct DeclaredSymbol {
    pub ref_: Ref,
    pub is_top_level: bool,
}

pub struct DeclaredSymbolList {
    pub(crate) entries: MultiArrayList<DeclaredSymbol, bun_alloc::AstAlloc>,
}

impl Default for DeclaredSymbolList {
    fn default() -> Self {
        Self {
            entries: MultiArrayList::new_in(bun_alloc::AstAlloc),
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
        other: &DeclaredSymbolList,
    ) -> core::result::Result<(), bun_alloc::AllocError> {
        self.ensure_unused_capacity(other.len())?;
        self.append_list_assume_capacity(other);
        Ok(())
    }

    pub(crate) fn append_list_assume_capacity(&mut self, other: &DeclaredSymbolList) {
        self.entries.append_list_assume_capacity(&other.entries);
    }

    pub fn append_assume_capacity(&mut self, entry: DeclaredSymbol) {
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
        let mut entries = MultiArrayList::new_in(bun_alloc::AstAlloc);
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

pub type DependencyList = bun_alloc::AstVec<Dependency>;

// PERF: these may be arena-backed in callers; revisit with
// bumpalo::collections::Vec if profiling shows churn.

/// Each file is made up of multiple parts, and each part consists of one or
/// more top-level statements. Parts are used for tree shaking and code
/// splitting analysis. Individual parts of a file can be discarded by tree
/// shaking and can be assigned to separate chunks (i.e. output files) by code
/// splitting.
pub struct Part {
    pub stmts: StoreSlice<Stmt>,
    pub scopes: StoreSlice<*mut Scope>, // TODO: &'bump mut [&'bump mut Scope]

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
    pub import_symbol_property_uses: Option<bun_alloc::AstBox<PartSymbolPropertyUseMap>>,

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

    // Liveness moved out to a sidecar `LinkerGraph::parts_live` bitset so the
    // tree-shaking recursion's hot "already visited?" check touches a few KB
    // of bitset words instead of striding across every 272-byte `Part`.
    pub tag: PartTag,
}

pub type PartImportRecordIndices = Vec<u32, bun_alloc::AstAlloc>;
pub type PartList<'a> = bun_alloc::ArenaVec<'a, Part>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PartTag {
    None,
    JsxImport,
    Runtime,
    CjsImports,
    ReactFastRefresh,
    ReactCompiler,
    DirnameFilename,
    BunTest,
    DeadDueToInlining,
    CommonjsNamedExport,
    ImportToConvertFromRequire,
}

pub type PartSymbolUseMap = ArrayHashMap<Ref, symbol::Use, AutoContext, bun_alloc::AstAlloc>;
pub type PartSymbolPropertyUseMap = ArrayHashMap<
    Ref,
    StringHashMap<symbol::Use, bun_alloc::AstAlloc>,
    AutoContext,
    bun_alloc::AstAlloc,
>;

impl Default for Part {
    fn default() -> Self {
        Self {
            stmts: StoreSlice::EMPTY,
            scopes: StoreSlice::EMPTY,
            import_record_indices: PartImportRecordIndices::new_in(bun_alloc::AstAlloc),
            declared_symbols: DeclaredSymbolList::default(),
            symbol_uses: PartSymbolUseMap::default(),
            import_symbol_property_uses: None,
            dependencies: Vec::new_in(bun_alloc::AstAlloc),
            can_be_removed_if_unused: false,
            force_tree_shaking: false,
            tag: PartTag::None,
        }
    }
}

#[derive(Clone, Copy)]
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
                    // The StoreRef arena slot is never individually dropped, so
                    // `take` (replace with Default) is safe here.
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
    pub local_parts_with_uses: bun_alloc::AstVec<u32>,

    /// The original export name from the source module being imported.
    /// Examples:
    /// - `import { foo } from 'module'` → alias = "foo"
    /// - `import { foo as bar } from 'module'` → alias = "foo" (original export name)
    /// - `import * as ns from 'module'` → alias_is_star = true, alias = ""
    /// This field is used by the bundler to match imports with their corresponding
    /// exports and for error reporting when imports can't be resolved.
    pub alias: Option<ArenaStr>,
    pub alias_loc: crate::Loc,
    pub namespace_ref: Ref,
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

impl Default for NamedImport {
    fn default() -> Self {
        Self {
            local_parts_with_uses: bun_alloc::AstAlloc::vec(),
            alias: None,
            alias_loc: crate::Loc::EMPTY,
            namespace_ref: Ref::NONE,
            import_record_index: 0,
            alias_is_star: false,
            is_exported: false,
        }
    }
}

#[derive(Copy, Clone)]
pub struct NamedExport {
    pub ref_: Ref,
    pub alias_loc: crate::Loc,
}

#[repr(u8)]
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

// ═════════════════════════════════════════════════════════════════════════
// Symbols pulled DOWN from higher-tier
// crates so lower-tier callers (css, interchange, js_parser itself) can
// resolve them here without forming a cycle.
// ═════════════════════════════════════════════════════════════════════════

// ─── from bun_jsc::math ─────────────────────────────────────────────────────
pub mod math {
    /// `Number.MAX_SAFE_INTEGER` (2^53 - 1)
    pub(crate) const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;
    /// `Number.MIN_SAFE_INTEGER` (-(2^53 - 1))
    pub(crate) const MIN_SAFE_INTEGER: f64 = -9007199254740991.0;

    unsafe extern "C" {
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
// ─── from bun_bundler::v2::MangledProps ─────────────────────────────────────
// LIFETIMES.tsv: value slices point into the parser arena → `StoreStr`
// (arena-owned, no `'bump` cascade).
