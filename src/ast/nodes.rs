//! Core AST node payload types and arena-slice helpers.

use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

use bun_core::Output;

use crate::char_freq::CHAR_FREQ_COUNT;
use crate::{AstArena, AstArrayHashMap, AstBox, AstStringHashMap, AstVec};
use crate::{Binding, E, Expr, Index, Ref, Scope, Stmt, symbol};

pub use crate::flags as Flags;

// ───────────────────────────────────────────────────────────────────────────
// StoreRef — pointer to a node in an arena.
//
// Thin `NonNull<T>` newtype — `Copy`, `Deref`/`DerefMut`. The pointee lives
// for `'a`. Invariant in `T`, because any copy can write a `T`.
//
// `packed(4)` lowers the alignment to 4 without changing the single-scalar
// representation: still passed/returned in one register, `self.0` is one `mov`,
// and `Option<StoreRef<T>>` keeps its `NonNull` niche. The align-4 part is what
// lets `expr::Data`/`stmt::Data` drop to align 4 and `Expr`/`Stmt`/`Binding`
// pack into 16 bytes.
// ───────────────────────────────────────────────────────────────────────────

#[repr(C, packed(4))]
pub struct StoreRef<'a, T>(NonNull<T>, PhantomData<&'a mut T>);

const _: () = assert!(core::mem::size_of::<StoreRef<u8>>() == 8);
const _: () = assert!(core::mem::align_of::<StoreRef<u8>>() == 4);
const _: () = assert!(core::mem::size_of::<Option<StoreRef<u8>>>() == 8);

// SAFETY: `StoreRef` is a thin pointer into a single-threaded bump arena.
// We assert Send/Sync so payload types embedding `Option<StoreRef<T>>`
// (e.g. `E::EString::next`) can sit in `static` tables. Callers are
// responsible for not actually sharing an arena across threads.
//
// Bounded on `T` so `StoreRef` cannot launder a `!Send`/`!Sync` payload (e.g.
// `StoreRef<Cell<_>>`) past auto-trait inference: it is `Copy`, and every copy
// yields `&T` (needs `T: Sync`) and `&mut T` (needs `T: Send`).
unsafe impl<T: Send + Sync> Send for StoreRef<'_, T> {}
// SAFETY: see the `Send` impl above.
unsafe impl<T: Send + Sync> Sync for StoreRef<'_, T> {}

impl<'a, T> StoreRef<'a, T> {
    /// Wrap a `bumpalo::Bump::alloc` result.
    #[inline]
    pub fn from_bump(r: &'a mut T) -> Self {
        StoreRef(NonNull::from(r), PhantomData)
    }
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    /// Borrow the pointee for as long as it lives.
    #[inline]
    pub fn get(&self) -> &'a T {
        // SAFETY: every constructor takes a borrow that is valid for `'a`.
        unsafe { &*self.as_ptr() }
    }
    /// `DerefMut` for as long as the pointee lives.
    #[inline]
    pub fn into_mut(self) -> &'a mut T {
        // SAFETY: valid for `'a`, as in `get`. AST nodes are mutated in-place during
        // visiting; no two `StoreRef` to the same node are deref'd `&mut`
        // simultaneously in single-threaded parser/visitor passes.
        unsafe { &mut *self.as_ptr() }
    }
}
impl<T> Clone for StoreRef<'_, T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for StoreRef<'_, T> {}
impl<T> Deref for StoreRef<'_, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.get()
    }
}
impl<T> DerefMut for StoreRef<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        self.into_mut()
    }
}
/// Pointer-identity comparison.
impl<T> PartialEq for StoreRef<'_, T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        // Copy out of the packed field before comparing (`NonNull::eq` takes
        // `&self`, which would require an unaligned reference).
        let (a, b) = (self.0, other.0);
        a == b
    }
}
impl<T> Eq for StoreRef<'_, T> {}

pub type ExprNodeIndex<'a> = Expr<'a>;
pub type StmtNodeIndex<'a> = Stmt<'a>;
pub type BindingNodeIndex<'a> = Binding<'a>;

// ─── arena-slice helpers ────────────────────────────────────────────────────
// Legacy alias: AST string fields now uniformly use `StoreStr` (safe `Deref`
// wrapper around an arena `[u8]`). Kept as a type alias so existing field
// declarations / call sites that spell `ArenaStr` continue to compile.
pub(crate) type ArenaStr<'a> = StoreStr<'a>;
#[inline]
const fn empty_arena_str() -> ArenaStr<'static> {
    StoreStr::EMPTY
}
// (former `empty_arena_slice_mut<T>()` removed — use `StoreSlice::<T>::EMPTY`.)

// ─── StoreStr — arena-owned string slice (StoreRef's [u8] sibling) ──────────
//
// A `&'a [u8]` for AST string fields (`E::Dot.name`, `E::String.data`, …).
// Layout matches `StoreSlice<u8>`: `packed(4)` lowers `NonNull<u8>` to align 4
// so the struct is 12 bytes instead of 16. The `u32` length keeps the 4 GB
// source-file limit explicit.
#[derive(Copy, Clone)]
#[repr(C, packed(4))]
pub struct StoreStr<'a> {
    ptr: NonNull<u8>,
    len: u32,
    _marker: PhantomData<&'a [u8]>,
}

const _: () = assert!(core::mem::size_of::<StoreStr>() == 12);
const _: () = assert!(core::mem::align_of::<StoreStr>() == 4);

// SAFETY: it is made from a `&'a [u8]` and only hands one out.
unsafe impl Send for StoreStr<'_> {}
// SAFETY: see the `Send` impl above.
unsafe impl Sync for StoreStr<'_> {}

impl<'a> StoreStr<'a> {
    pub const EMPTY: StoreStr<'a> = StoreStr {
        ptr: NonNull::<u8>::dangling(),
        len: 0,
        _marker: PhantomData,
    };

    #[inline]
    pub const fn new(s: &'a [u8]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        StoreStr {
            ptr: NonNull::from_ref(s).cast(),
            len: s.len() as u32,
            _marker: PhantomData,
        }
    }

    #[inline]
    pub const fn as_ptr(self) -> *const u8 {
        self.ptr.as_ptr()
    }

    #[inline]
    pub const fn raw_len(self) -> usize {
        self.len as usize
    }

    #[inline]
    pub fn slice(self) -> &'a [u8] {
        // SAFETY: `ptr` and `len` are the start of a `&'a [u8]`, or `EMPTY`.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    #[inline]
    pub fn as_raw(self) -> *const [u8] {
        core::ptr::slice_from_raw_parts(self.ptr.as_ptr(), self.len as usize)
    }
}

impl Default for StoreStr<'_> {
    #[inline]
    fn default() -> Self {
        StoreStr::EMPTY
    }
}

impl core::ops::Deref for StoreStr<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.slice()
    }
}

impl AsRef<[u8]> for StoreStr<'_> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.slice()
    }
}
impl core::borrow::Borrow<[u8]> for StoreStr<'_> {
    #[inline]
    fn borrow(&self) -> &[u8] {
        self.slice()
    }
}

impl<'a, const N: usize> From<&'a [u8; N]> for StoreStr<'a> {
    #[inline]
    fn from(s: &'a [u8; N]) -> Self {
        StoreStr::new(s)
    }
}
impl<'a> From<&'a [u8]> for StoreStr<'a> {
    #[inline]
    fn from(s: &'a [u8]) -> Self {
        StoreStr::new(s)
    }
}
impl<'a> From<&'a str> for StoreStr<'a> {
    #[inline]
    fn from(s: &'a str) -> Self {
        StoreStr::new(s.as_bytes())
    }
}

impl PartialEq for StoreStr<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.slice() == other.slice()
    }
}
impl Eq for StoreStr<'_> {}
impl PartialEq<[u8]> for StoreStr<'_> {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        self.slice() == other
    }
}
impl<const N: usize> PartialEq<&[u8; N]> for StoreStr<'_> {
    #[inline]
    fn eq(&self, other: &&[u8; N]) -> bool {
        self.slice() == *other
    }
}
impl<const N: usize> PartialEq<[u8; N]> for StoreStr<'_> {
    #[inline]
    fn eq(&self, other: &[u8; N]) -> bool {
        self.slice() == other
    }
}
impl PartialEq<&[u8]> for StoreStr<'_> {
    #[inline]
    fn eq(&self, other: &&[u8]) -> bool {
        self.slice() == *other
    }
}
impl core::hash::Hash for StoreStr<'_> {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        self.slice().hash(h)
    }
}
impl core::fmt::Debug for StoreStr<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        bstr::BStr::new(self.slice()).fmt(f)
    }
}

// ─── StoreSlice<T> — arena-owned typed slice (StoreStr's generic sibling) ───
//
// Generalizes `StoreStr` to `[T]` for AST list fields (`E::Arrow.args`,
// per-node `[Stmt]`/`[Expr]` views, …) that borrow from the parse arena.
// The items live for `'a`. Invariant in `T`, as `StoreRef` is.
//
// Layout: `packed(4)` lowers `NonNull<T>` to align 4 so the field is 12 bytes
// instead of 16. The pointer stays a single scalar (one `mov` to read), and the
// `u32` length keeps the 4 G-element ceiling explicit.
#[repr(C, packed(4))]
pub struct StoreSlice<'a, T> {
    ptr: NonNull<T>,
    len: u32,
    _marker: PhantomData<&'a mut [T]>,
}

const _: () = assert!(core::mem::size_of::<StoreSlice<u8>>() == 12);
const _: () = assert!(core::mem::align_of::<StoreSlice<u8>>() == 4);

// Manual Copy/Clone: derive would add a spurious `T: Copy` bound.
impl<T> Copy for StoreSlice<'_, T> {}
impl<T> Clone for StoreSlice<'_, T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

// SAFETY: same rationale as `StoreRef`.
unsafe impl<T: Send + Sync> Send for StoreSlice<'_, T> {}
// SAFETY: see the `Send` impl above.
unsafe impl<T: Send + Sync> Sync for StoreSlice<'_, T> {}

impl<'a, T> StoreSlice<'a, T> {
    pub const EMPTY: StoreSlice<'a, T> = StoreSlice {
        ptr: NonNull::<T>::dangling(),
        len: 0,
        _marker: PhantomData,
    };

    /// Wrap an arena-owned mutable slice (e.g. `bump.alloc_slice_*`).
    #[inline]
    pub fn new_mut(s: &'a mut [T]) -> Self {
        debug_assert!(s.len() <= u32::MAX as usize);
        StoreSlice {
            ptr: NonNull::from_mut(s).cast(),
            len: s.len() as u32,
            _marker: PhantomData,
        }
    }

    pub fn from_iter_in(items: impl IntoIterator<Item = T>, arena: &'a AstArena) -> Self {
        AstVec::from_iter_in(items, arena).into_store_slice()
    }

    #[inline]
    pub fn slice(self) -> &'a [T] {
        // SAFETY: `ptr` and `len` are the start of a slice that is valid for `'a`, or `EMPTY`.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Re-borrow as `&mut [T]`. The single-threaded parser/visitor
    /// pass holds at most one live `&mut` per node (mirrors `StoreRef`'s safe
    /// `DerefMut`, which already encodes this invariant). The arena hands out
    /// unique allocations and `StoreSlice` is `Copy`, so aliasing cannot be
    /// *statically* checked — but neither can `StoreRef::deref_mut`'s, and the
    /// two share one safety story. Callers must not overlap a `slice_mut()`
    /// borrow with another `slice()`/`slice_mut()` of the same allocation.
    #[inline]
    pub fn slice_mut(self) -> &'a mut [T] {
        // SAFETY: StoreSlice invariant — `ptr` is non-null, points at `len`
        // initialized `T` valid for `'a`; uniqueness is upheld
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
    pub fn from_bump(v: bun_alloc::ArenaVec<'a, T>) -> Self {
        use bun_alloc::ArenaVecExt as _;
        StoreSlice::new_mut(v.into_bump_slice_mut())
    }
}

impl<'a, T> From<bun_alloc::ArenaVec<'a, T>> for StoreSlice<'a, T> {
    #[inline]
    fn from(v: bun_alloc::ArenaVec<'a, T>) -> Self {
        StoreSlice::from_bump(v)
    }
}

impl<T> Default for StoreSlice<'_, T> {
    #[inline]
    fn default() -> Self {
        StoreSlice::EMPTY
    }
}

impl<T> core::ops::Deref for StoreSlice<'_, T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}

impl<T> AsRef<[T]> for StoreSlice<'_, T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.slice()
    }
}

impl<'a, T> From<&'a mut [T]> for StoreSlice<'a, T> {
    #[inline]
    fn from(s: &'a mut [T]) -> Self {
        StoreSlice::new_mut(s)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for StoreSlice<'_, T> {
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
pub type ExprNodeList<'a> = AstVec<'a, Expr<'a>>;

// Arena-owned `[Stmt]` view — see `StoreSlice<T>` doc above.
pub type StmtNodeList<'a> = StoreSlice<'a, Stmt<'a>>;

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

#[derive(Clone, Copy)]
pub struct ClauseItem<'a> {
    /// The local alias used for the imported/exported symbol in the current module.
    /// For imports: `import { foo as bar }` - "bar" is the alias
    /// For exports: `export { foo as bar }` - "bar" is the alias
    /// For re-exports: `export { foo as bar } from 'path'` - "bar" is the alias
    pub alias: ArenaStr<'a>,
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
    pub original_name: ArenaStr<'a>,
}

impl ClauseItem<'_> {
    pub const DEFAULT_ALIAS: &'static [u8] = b"default";
}

impl Default for ClauseItem<'_> {
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
    pub head: Vec<u8>,
    pub(crate) tail: Vec<u8>,
}

impl NameMinifier {
    pub(crate) const DEFAULT_HEAD: &'static [u8] =
        b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
    pub(crate) const DEFAULT_TAIL: &'static [u8] =
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

pub struct EnumValue<'a> {
    pub loc: crate::Loc,
    pub ref_: Ref,
    pub name: ArenaStr<'a>,
    pub value: Option<ExprNodeIndex<'a>>,
}

impl<'a> EnumValue<'a> {
    pub fn name_as_e_string(&self, bump: &'a bun_alloc::Arena) -> E::String<'a> {
        E::String::init_re_encode_utf8(self.name.slice(), bump)
    }
}

pub struct Catch<'a> {
    pub loc: crate::Loc,
    pub binding: Option<BindingNodeIndex<'a>>,
    pub body: StmtNodeList<'a>,
    pub body_loc: crate::Loc,
}

pub struct Finally<'a> {
    pub loc: crate::Loc,
    pub stmts: StmtNodeList<'a>,
    pub body_loc: crate::Loc,
}

pub struct Case<'a> {
    pub loc: crate::Loc,
    pub value: Option<ExprNodeIndex<'a>>,
    pub body: StmtNodeList<'a>,
}

pub struct ArrayBinding<'a> {
    pub binding: BindingNodeIndex<'a>,
    pub default_value: Option<ExprNodeIndex<'a>>,
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
pub struct Span<'a> {
    pub text: ArenaStr<'a>,
    pub range: crate::Range,
}

impl Default for Span<'_> {
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
pub struct InlinedEnumValue<'a> {
    raw_data: u64,
    _marker: PhantomData<InlinedEnumValueDecoded<'a>>,
}

#[derive(Copy, Clone)]
pub enum InlinedEnumValueDecoded<'a> {
    String(StoreRef<'a, E::String<'a>>),
    Number(f64),
}

impl<'a> InlinedEnumValue<'a> {
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

    pub fn encode(decoded: InlinedEnumValueDecoded<'a>) -> Self {
        let encoded = InlinedEnumValue {
            raw_data: match decoded {
                InlinedEnumValueDecoded::String(str_) => {
                    (str_.as_ptr() as usize as u64) & 0x0000_FFFF_FFFF_FFFF
                } // @truncate to u48
                InlinedEnumValueDecoded::Number(num) => {
                    Self::purify_nan(num).to_bits() + Self::DOUBLE_ENCODE_OFFSET
                }
            },
            _marker: PhantomData,
        };
        debug_assert!(match encoded.decode() {
            InlinedEnumValueDecoded::String(str_) => match decoded {
                InlinedEnumValueDecoded::String(orig) => str_ == orig,
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

    pub fn decode(self) -> InlinedEnumValueDecoded<'a> {
        if self.raw_data > 0x0000_FFFF_FFFF_FFFF {
            InlinedEnumValueDecoded::Number(f64::from_bits(
                self.raw_data - Self::DOUBLE_ENCODE_OFFSET,
            ))
        } else {
            // SAFETY: `encode` stored the address of a `StoreRef<'a, _>`, which fits in 48 bits.
            let node = unsafe { NonNull::new_unchecked(self.raw_data as usize as *mut E::String) };
            InlinedEnumValueDecoded::String(StoreRef(node, PhantomData))
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
}

#[derive(Copy, Clone)]
pub struct DeclaredSymbol {
    pub ref_: Ref,
    pub is_top_level: bool,
}

#[derive(Default)]
pub struct DeclaredSymbolList<'a> {
    refs: AstVec<'a, Ref>,
    is_top_level: AstVec<'a, bool>,
}

impl<'a> DeclaredSymbolList<'a> {
    pub fn refs(&self) -> &[Ref] {
        &self.refs
    }

    pub fn to_owned_slice(&mut self) -> Self {
        core::mem::take(self)
    }

    pub fn clone_in(&self, arena: &'a AstArena) -> Self {
        DeclaredSymbolList {
            refs: AstVec::from_slice_in(&self.refs, arena),
            is_top_level: AstVec::from_slice_in(&self.is_top_level, arena),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.refs.len()
    }

    pub fn append(&mut self, arena: &'a AstArena, entry: DeclaredSymbol) {
        self.refs.push(arena, entry.ref_);
        self.is_top_level.push(arena, entry.is_top_level);
    }

    pub fn append_list(&mut self, arena: &'a AstArena, other: &DeclaredSymbolList) {
        self.refs.extend_from_slice(arena, &other.refs);
        self.is_top_level
            .extend_from_slice(arena, &other.is_top_level);
    }

    pub fn clear_retaining_capacity(&mut self) {
        self.refs.clear();
        self.is_top_level.clear();
    }

    pub fn with_capacity_in(capacity: usize, arena: &'a AstArena) -> Self {
        DeclaredSymbolList {
            refs: AstVec::with_capacity_in(capacity, arena),
            is_top_level: AstVec::with_capacity_in(capacity, arena),
        }
    }

    pub fn from_slice_in(entries: &[DeclaredSymbol], arena: &'a AstArena) -> Self {
        DeclaredSymbolList {
            refs: AstVec::from_iter_in(entries.iter().map(|entry| entry.ref_), arena),
            is_top_level: AstVec::from_iter_in(
                entries.iter().map(|entry| entry.is_top_level),
                arena,
            ),
        }
    }
}

impl DeclaredSymbol {
    fn for_each_top_level_symbol_with_type<C>(
        decls: &DeclaredSymbolList,
        ctx: &mut C,
        f: impl Fn(&mut C, Ref),
    ) {
        // TODO: SIMD
        debug_assert_eq!(decls.is_top_level.len(), decls.refs.len());
        for (top, ref_) in decls.is_top_level.iter().zip(&decls.refs) {
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

pub type DependencyList<'a> = AstVec<'a, Dependency>;

// PERF: these may be arena-backed in callers; revisit with
// bumpalo::collections::Vec if profiling shows churn.

/// Each file is made up of multiple parts, and each part consists of one or
/// more top-level statements. Parts are used for tree shaking and code
/// splitting analysis. Individual parts of a file can be discarded by tree
/// shaking and can be assigned to separate chunks (i.e. output files) by code
/// splitting.
pub struct Part<'a> {
    pub stmts: StmtNodeList<'a>,
    pub scopes: StoreSlice<'a, StoreRef<'a, Scope<'a>>>,

    /// Each is an index into the file-level import record list
    pub import_record_indices: PartImportRecordIndices<'a>,

    /// All symbols that are declared in this part. Note that a given symbol may
    /// have multiple declarations, and so may end up being declared in multiple
    /// parts (e.g. multiple "var" declarations with the same name). Also note
    /// that this list isn't deduplicated and may contain duplicates.
    pub declared_symbols: DeclaredSymbolList<'a>,

    /// An estimate of the number of uses of all symbols used within this part.
    pub symbol_uses: PartSymbolUseMap<'a>,

    /// This tracks property accesses off of imported symbols. We don't know
    /// during parsing if an imported symbol is going to be an inlined enum
    /// value or not. This is only known during linking. So we defer adding
    /// a dependency on these imported symbols until we know whether the
    /// property access is an inlined enum value or not.
    pub import_symbol_property_uses: Option<AstBox<'a, PartSymbolPropertyUseMap<'a>>>,

    /// The indices of the other parts in this file that are needed if this part
    /// is needed.
    pub dependencies: DependencyList<'a>,

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

pub type PartImportRecordIndices<'a> = AstVec<'a, u32>;
pub type PartList<'a> = bun_alloc::ArenaVec<'a, Part<'a>>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PartTag {
    None,
    JsxImport,
    Runtime,
    ReactCompiler,
    DirnameFilename,
    BunTest,
    DeadDueToInlining,
    CommonjsNamedExport,
    ImportToConvertFromRequire,
}

pub type PartSymbolUseMap<'a> = AstArrayHashMap<'a, Ref, symbol::Use>;
pub type PartSymbolPropertyUseMap<'a> = AstArrayHashMap<'a, Ref, AstStringHashMap<'a, PropertyUse>>;

/// The reads of one `X.name` in `Part::import_symbol_property_uses`.
#[derive(Default, Clone, Copy)]
pub struct PropertyUse {
    pub count_estimate: u32,
    /// Some read is called, as `X.name()` or a template tag, with `X` as `this`.
    pub is_call_target: bool,
}

impl Default for Part<'_> {
    fn default() -> Self {
        Self {
            stmts: StoreSlice::EMPTY,
            scopes: StoreSlice::EMPTY,
            import_record_indices: AstVec::new(),
            declared_symbols: DeclaredSymbolList::default(),
            symbol_uses: PartSymbolUseMap::default(),
            import_symbol_property_uses: None,
            dependencies: AstVec::new(),
            can_be_removed_if_unused: false,
            force_tree_shaking: false,
            tag: PartTag::None,
        }
    }
}

#[derive(Clone, Copy)]
pub enum StmtOrExpr<'a> {
    Stmt(Stmt<'a>),
    Expr(Expr<'a>),
}

impl Default for StmtOrExpr<'_> {
    fn default() -> Self {
        StmtOrExpr::Expr(Expr::default())
    }
}

impl<'a> StmtOrExpr<'a> {
    pub fn to_expr(self, bump: &'a AstArena) -> Expr<'a> {
        match self {
            StmtOrExpr::Expr(expr) => expr,
            StmtOrExpr::Stmt(stmt) => match stmt.data {
                crate::stmt::Data::SFunction(mut s) => {
                    // The StoreRef arena slot is never individually dropped, so
                    // `take` (replace with Default) is safe here.
                    let func = core::mem::take(&mut s.func);
                    Expr::allocate(bump, E::Function { func }, stmt.loc)
                }
                crate::stmt::Data::SClass(mut s) => {
                    let class = core::mem::take(&mut s.class);
                    Expr::allocate::<E::Class>(bump, class, stmt.loc)
                }
                other => Output::panic(format_args!(
                    "Unexpected statement type in default export: .{}",
                    <&'static str>::from(other.tag())
                )),
            },
        }
    }
}

pub struct NamedImport<'a> {
    /// Parts within this file that use this import
    pub local_parts_with_uses: AstVec<'a, u32>,

    /// The original export name from the source module being imported.
    /// Examples:
    /// - `import { foo } from 'module'` → alias = "foo"
    /// - `import { foo as bar } from 'module'` → alias = "foo" (original export name)
    /// - `import * as ns from 'module'` → alias_is_star = true, alias = ""
    /// This field is used by the bundler to match imports with their corresponding
    /// exports and for error reporting when imports can't be resolved.
    pub alias: Option<ArenaStr<'a>>,
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
    OutOfMemory,
    JSError,
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
