//! Generic trait-based dispatch for CSS value operations.
//!
//! The Zig original (`generics.zig`) uses `@typeInfo`/`@hasDecl`/`@field` comptime
//! reflection to derive `eql`, `hash`, `deepClone`, `toCss`, `parse`, etc. across
//! every CSS value type. Per PORTING.md §Comptime reflection, that has no Rust
//! equivalent — the port defines a trait per protocol, provides blanket impls for
//! the structural cases (Option/Box/slice/Vec/BabyList/SmallList/primitives), and
//! per-struct/-enum impls are expected to come from `#[derive(...)]` macros in
//! Phase B (`#[derive(ToCss, DeepClone, CssEql, CssHash)]` etc.).
//!
//! Free functions with the original names are kept as thin trait-method wrappers
//! so call sites in sibling files port 1:1.

use core::cmp::Ordering;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
// Zig `std.hash.Wyhash` (iterative) → `Wyhash11` (the iterative impl in bun_wyhash).
// Re-exported `pub` so `#[derive(CssHash)]` (in `bun_css_derive`) can name the
// hasher type as `::bun_css::generics::Wyhash` without depending on `bun_wyhash`
// directly.
pub use bun_wyhash::Wyhash11 as Wyhash;

use crate::css_parser as css;
use crate::css_parser::{Parser, ParserOptions};
use crate::printer::Printer;
use crate::values as css_values;
use crate::SmallList;
use crate::{PrintErr, VendorPrefix};
use crate::css_parser::CssResult;
use crate::values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use crate::values::ident::{CustomIdent, CustomIdentFns, DashedIdent, DashedIdentFns, Ident, IdentFns};
use crate::values::angle::Angle;
use crate::values::size::Size2D;
use crate::values::rect::Rect;

// `ArrayList(T)` in the Zig is `std.ArrayListUnmanaged(T)` fed the parser arena.
// In this AST crate that maps to `bumpalo::collections::Vec<'bump, T>`.
pub type ArrayList<'bump, T> = bumpalo::collections::Vec<'bump, T>;

// ───────────────────────────────────────────────────────────────────────────────
// DeepClone
// ───────────────────────────────────────────────────────────────────────────────

/// Arena-aware deep clone. Equivalent of Zig's `deepClone(T, *const T, Allocator) T`.
///
/// Per-struct/-enum impls are expected from `#[derive(DeepClone)]` (Phase B);
/// the Zig `implementDeepClone` body is the spec for that derive (field-wise /
/// variant-wise recursion).
pub trait DeepClone<'bump>: Sized {
    fn deep_clone(&self, bump: &'bump Arena) -> Self;
}

/// `#[derive(DeepClone)]` — field-wise / variant-wise port of Zig's
/// `css.implementDeepClone`. See `src/css_derive/lib.rs` for the expansion
/// rules. Re-exported here so `use crate::generics::DeepClone;` brings both
/// the trait and the derive into scope (same-name trait+derive is the std
/// idiom, cf. `Clone`).
pub use bun_css_derive::DeepClone;

#[inline]
pub fn implement_deep_clone<'bump, T: DeepClone<'bump>>(this: &T, bump: &'bump Arena) -> T {
    // TODO(port): Zig `implementDeepClone` is comptime field/variant reflection.
    // In Rust this is the body of `#[derive(DeepClone)]`; the free fn just
    // forwards to the trait so existing callers keep working.
    this.deep_clone(bump)
}

#[inline]
pub fn deep_clone<'bump, T: DeepClone<'bump>>(this: &T, bump: &'bump Arena) -> T {
    this.deep_clone(bump)
}

pub fn can_transitively_implement_deep_clone<T>() -> bool {
    // TODO(port): Zig checks `@typeInfo(T) == .struct | .union`. In Rust this
    // gate becomes "does T impl DeepClone" — i.e. a trait bound at the call
    // site, not a runtime check. Kept as a stub for diff parity.
    true
}

// Blanket impls covering the structural cases the Zig switch handled inline.

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Option<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        match self {
            Some(v) => Some(v.deep_clone(bump)),
            None => None,
        }
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for &'bump T {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // Zig: `bun.create(allocator, TT, deepClone(TT, this.*, allocator))`
        bump.alloc((**self).deep_clone(bump))
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for &'bump [T] {
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // Zig: alloc slice, then memcpy if simple-copy else element-wise deepClone.
        // PERF(port): Zig fast-paths `isSimpleCopyType` with @memcpy — profile in Phase B
        // (specialization would let `T: Copy` use `alloc_slice_copy`).
        bump.alloc_slice_fill_iter(self.iter().map(|e| e.deep_clone(bump)))
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for ArrayList<'bump, T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // Zig: `css.deepClone(T, allocator, this)` → alloc capacity, element-wise deepClone.
        // PERF(port): Zig fast-paths simple-copy types with @memcpy — profile in Phase B.
        let mut out = ArrayList::with_capacity_in(self.len(), bump);
        for item in self.iter() {
            out.push(item.deep_clone(bump));
        }
        out
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for BabyList<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // `BabyList::deep_clone_with` takes a per-element closure so the arena
        // lifetime carried by *this* trait's `deep_clone` threads through.
        self.deep_clone_with(|e| e.deep_clone(bump))
    }
}

impl<'bump, T: DeepClone<'bump>, const N: usize> DeepClone<'bump> for SmallList<T, N> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        let mut ret = SmallList::<T, N>::init_capacity(self.len());
        for item in self.slice() {
            ret.append(item.deep_clone(bump));
        }
        ret
    }
}

// "Simple copy types" + arena-borrowed strings: clone is identity.
macro_rules! deep_clone_copy {
    ($($t:ty),* $(,)?) => {$(
        impl<'bump> DeepClone<'bump> for $t {
            #[inline]
            fn deep_clone(&self, _bump: &'bump Arena) -> Self { *self }
        }
    )*};
}
// `u8` is intentionally omitted: a `DeepClone for u8` impl would make the
// generic `&'bump [T]` impl below overlap the explicit `&'bump [u8]` impl
// (Rust has no stable specialization). Bytes only appear as `[u8]` slices in
// the CSS AST, never as standalone values.
deep_clone_copy!(f32, f64, i32, u32, i64, u64, usize, isize, u16, bool);

impl<'bump> DeepClone<'bump> for &'bump [u8] {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        // Strings in the CSS parser are always arena allocated
        // So it is safe to skip const strings as they will never be mutated
        *self
    }
}

impl<'bump> DeepClone<'bump> for &'bump str {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        // Same arena-borrowed-string rule as `&[u8]` above.
        *self
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Vec<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // PERF(port): Zig fast-paths simple-copy types with @memcpy — profile in Phase B.
        let mut out = Vec::with_capacity(self.len());
        for item in self.iter() {
            out.push(item.deep_clone(bump));
        }
        out
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Box<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        Box::new((**self).deep_clone(bump))
    }
}

impl<'bump> DeepClone<'bump> for bun_logger::Loc {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        *self
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Eql
// ───────────────────────────────────────────────────────────────────────────────

/// `lhs.eql(&rhs)` for CSS types. This is the equivalent of doing
/// `#[derive(PartialEq)]` in Rust — and in Phase B most impls should be exactly
/// that. Kept as a separate trait because some CSS types want structural
/// equality that differs from `PartialEq` (e.g. `VendorPrefix`, idents).
pub trait CssEql {
    fn eql(&self, other: &Self) -> bool;
}

/// `#[derive(CssEql)]` — field-wise / variant-wise port of Zig's
/// `css.implementEql`. See `src/css_derive/lib.rs` for the expansion rules.
/// Re-exported here so `use crate::generics::CssEql;` brings both trait and
/// derive into scope (same-name idiom, cf. `Clone`).
pub use bun_css_derive::CssEql;

#[inline]
pub fn implement_eql<T: CssEql>(this: &T, other: &T) -> bool {
    // TODO(port): Zig `implementEql` is comptime field/variant reflection ==
    // the body of `#[derive(CssEql)]`. Free fn forwards to trait.
    this.eql(other)
}

#[inline]
pub fn eql<T: CssEql>(lhs: &T, rhs: &T) -> bool {
    lhs.eql(rhs)
}

pub fn eql_list<T: CssEql>(lhs: &ArrayList<'_, T>, rhs: &ArrayList<'_, T>) -> bool {
    if lhs.len() != rhs.len() {
        return false;
    }
    debug_assert_eq!(lhs.len(), rhs.len());
    for (left, right) in lhs.iter().zip(rhs.iter()) {
        if !left.eql(right) {
            return false;
        }
    }
    true
}

pub fn can_transitively_implement_eql<T>() -> bool {
    // TODO(port): see can_transitively_implement_deep_clone — becomes a trait bound.
    true
}

// Blanket / base impls.

impl<T: CssEql> CssEql for Option<T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (None, None) => true,
            (Some(a), Some(b)) => a.eql(b),
            _ => false,
        }
    }
}

impl<T: CssEql + ?Sized> CssEql for &T {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        (**self).eql(&**other)
    }
}

impl<T: CssEql> CssEql for [T] {
    fn eql(&self, other: &Self) -> bool {
        if self.len() != other.len() {
            return false;
        }
        for (a, b) in self.iter().zip(other.iter()) {
            if !a.eql(b) {
                return false;
            }
        }
        true
    }
}

impl<'bump, T: CssEql> CssEql for ArrayList<'bump, T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        eql_list(self, other)
    }
}

impl<T: CssEql> CssEql for BabyList<T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.slice_const().eql(other.slice_const())
    }
}

impl<T: CssEql, const N: usize> CssEql for SmallList<T, N> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.slice().eql(other.slice())
    }
}

macro_rules! eql_simple {
    ($($t:ty),* $(,)?) => {$(
        impl CssEql for $t {
            #[inline]
            fn eql(&self, other: &Self) -> bool { *self == *other }
        }
    )*};
}
// `u8` omitted to avoid `[T]`/`[u8]` overlap — see deep_clone_copy! note.
eql_simple!(f32, f64, i32, u32, i64, u64, usize, isize, u16, bool);

impl CssEql for [u8] {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_string::strings::eql(self, other)
    }
}

impl CssEql for str {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_string::strings::eql(self.as_bytes(), other.as_bytes())
    }
}

impl<T: CssEql, const N: usize> CssEql for [T; N] {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        // Zig: element-wise eql (length is `N` on both sides by type).
        for (a, b) in self.iter().zip(other.iter()) {
            if !a.eql(b) {
                return false;
            }
        }
        true
    }
}

impl<T: CssEql> CssEql for Vec<T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.as_slice().eql(other.as_slice())
    }
}

impl<T: CssEql + ?Sized> CssEql for Box<T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        (**self).eql(&**other)
    }
}

impl CssEql for VendorPrefix {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        // Zig: `VendorPrefix.eql` is bitwise compare of the packed struct.
        *self == *other
    }
}

impl CssEql for bun_logger::Loc {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.start == other.start
    }
}

impl CssEql for () {
    #[inline]
    fn eql(&self, _other: &Self) -> bool {
        true
    }
}

// CustomIdent/DashedIdent/Ident wrapper structs are hoisted as data-only stubs
// in `crate::values::ident` (lib.rs); the full impls live in gated
// `values/ident.rs` and supersede these on un-gate.
mod ident_eql {
    use super::CssEql;
    use crate::values::ident::{CustomIdent, DashedIdent, Ident};

    macro_rules! ident_eql_impl {
        ($($t:ty),* $(,)?) => {$(
            impl CssEql for $t {
                #[inline]
                fn eql(&self, other: &Self) -> bool {
                    // SAFETY: `.v` borrows the parser arena, which outlives
                    // every CssEql comparison (callers hold the arena).
                    unsafe { bun_string::strings::eql(&*self.v, &*other.v) }
                }
            }
        )*};
    }
    ident_eql_impl!(CustomIdent, DashedIdent, Ident);
}

// TODO(port): Zig also special-cases `@typeInfo(T).struct.layout == .packed` →
// bitwise `==`. In Rust those are `bitflags!` types implementing `PartialEq`;
// add `impl<T: BitFlags> CssEql for T` or per-type impls in Phase B.

// ───────────────────────────────────────────────────────────────────────────────
// Hash
// ───────────────────────────────────────────────────────────────────────────────

pub const HASH_SEED: u64 = 0;

/// Wyhash-based structural hash for CSS values.
pub trait CssHash {
    fn hash(&self, hasher: &mut Wyhash);
}

/// `#[derive(CssHash)]` — field-wise / variant-wise port of Zig's
/// `css.implementHash`. See `src/css_derive/lib.rs` for the expansion rules.
/// Re-exported here so `use crate::generics::CssHash;` brings both trait and
/// derive into scope.
pub use bun_css_derive::CssHash;

#[inline]
pub fn implement_hash<T: CssHash>(this: &T, hasher: &mut Wyhash) {
    // TODO(port): Zig `implementHash` is comptime field/variant reflection ==
    // the body of `#[derive(CssHash)]`. Free fn forwards to trait.
    this.hash(hasher)
}

#[inline]
pub fn hash<T: CssHash>(this: &T, hasher: &mut Wyhash) {
    this.hash(hasher)
}

pub fn hash_array_list<V: CssHash>(this: &ArrayList<'_, V>, hasher: &mut Wyhash) {
    for item in this.iter() {
        item.hash(hasher);
    }
}

pub fn hash_baby_list<V: CssHash>(this: &BabyList<V>, hasher: &mut Wyhash) {
    for item in this.slice_const() {
        item.hash(hasher);
    }
}

pub fn has_hash<T>() -> bool {
    // TODO(port): becomes `T: CssHash` bound at call site; stub for diff parity.
    true
}

impl CssHash for () {
    #[inline]
    fn hash(&self, _hasher: &mut Wyhash) {}
}

impl<T: CssHash> CssHash for Option<T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        // Zig `hash()` dispatcher: Some → hash inner, None → no-op (no prefix).
        // The "null"/"some" prefixes are from implementHash's dead .optional arm
        // (guarded by @compileError) — do NOT emit them here.
        if let Some(v) = self {
            v.hash(hasher);
        }
    }
}

impl<T: CssHash + ?Sized> CssHash for &T {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        (**self).hash(hasher)
    }
}

impl<T: CssHash> CssHash for [T] {
    fn hash(&self, hasher: &mut Wyhash) {
        // Zig `hash()` for `.slice` pointers iterates items only — no len prefix.
        for item in self {
            item.hash(hasher);
        }
    }
}

impl<T: CssHash, const N: usize> CssHash for [T; N] {
    fn hash(&self, hasher: &mut Wyhash) {
        // Zig: `bun.writeAnyToHasher(hasher, list.len)` — feeds the raw bytes
        // of `usize` into the hasher. `bun_core::write_any_to_hasher` exists
        // but is `H: Hasher`-generic and routes through `Hasher::write`, which
        // for `Wyhash11` calls `update` — so inlining the `usize` byte-feed
        // here is byte-identical and avoids the trait hop.
        hasher.update(&self.len().to_ne_bytes());
        for item in self {
            item.hash(hasher);
        }
    }
}

impl<'bump, T: CssHash> CssHash for ArrayList<'bump, T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hash_array_list(self, hasher)
    }
}

impl<T: CssHash> CssHash for BabyList<T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hash_baby_list(self, hasher)
    }
}

impl<T: CssHash, const N: usize> CssHash for SmallList<T, N> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        for item in self.slice() {
            item.hash(hasher);
        }
    }
}

macro_rules! hash_simple {
    ($($t:ty),* $(,)?) => {$(
        impl CssHash for $t {
            #[inline]
            fn hash(&self, hasher: &mut Wyhash) {
                // Zig: `hasher.update(std.mem.asBytes(&this))`
                hasher.update(&self.to_ne_bytes());
            }
        }
    )*};
}
// `u8` omitted to avoid `[T]`/`[u8]` overlap — see deep_clone_copy! note.
hash_simple!(f32, f64, i32, u32, i64, u64, usize, isize, u16);

impl CssHash for bool {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(&[*self as u8]);
    }
}

impl CssHash for [u8] {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(self);
    }
}

impl CssHash for str {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        hasher.update(self.as_bytes());
    }
}

impl<T: CssHash> CssHash for Vec<T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        for item in self.iter() {
            item.hash(hasher);
        }
    }
}

impl<T: CssHash + ?Sized> CssHash for Box<T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        (**self).hash(hasher)
    }
}

impl CssHash for VendorPrefix {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        // Zig: `hasher.update(std.mem.asBytes(&this))` on the packed-struct repr.
        hasher.update(&[self.as_bits()]);
    }
}

impl CssHash for bun_logger::Loc {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        // Zig `implementHash` doesn't reach `Loc` (callers skip it), but
        // providing a structural hash here lets `#[derive(CssHash)]` types
        // include a `loc` field without `#[css(skip)]` if they want.
        hasher.update(&self.start.to_ne_bytes());
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// slice / isCompatible
// ───────────────────────────────────────────────────────────────────────────────

/// Uniform `.as_slice()` over the three list container shapes the CSS parser uses.
pub trait ListContainer {
    type Item;
    fn slice(&self) -> &[Self::Item];
}

impl<'bump, T> ListContainer for ArrayList<'bump, T> {
    type Item = T;
    #[inline]
    fn slice(&self) -> &[T] {
        self.as_slice()
    }
}
impl<T> ListContainer for BabyList<T> {
    type Item = T;
    #[inline]
    fn slice(&self) -> &[T] {
        self.slice_const()
    }
}
impl<T, const N: usize> ListContainer for SmallList<T, N> {
    type Item = T;
    #[inline]
    fn slice(&self) -> &[T] {
        SmallList::slice(self)
    }
}

#[inline]
pub fn slice<L: ListContainer>(val: &L) -> &[L::Item] {
    val.slice()
}

pub trait IsCompatible {
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool;
}

/// `#[derive(IsCompatible)]` — field-wise / variant-wise port of the
/// hand-written `isCompatible` pattern (struct → AND of fields, enum → unit
/// variants `true` / payload variants delegate). See `src/css_derive/lib.rs`.
/// Re-exported here so `use crate::generics::IsCompatible;` brings both trait
/// and derive into scope.
pub use bun_css_derive::IsCompatible;

#[inline]
pub fn is_compatible<T: IsCompatible>(val: &T, browsers: crate::targets::Browsers) -> bool {
    val.is_compatible(browsers)
}

impl<T: IsCompatible + ?Sized> IsCompatible for &T {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        (**self).is_compatible(browsers)
    }
}

impl<T: IsCompatible + ?Sized> IsCompatible for Box<T> {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        (**self).is_compatible(browsers)
    }
}

impl<T: IsCompatible> IsCompatible for Option<T> {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        // Zig's `isCompatible` doesn't special-case Optional, but every
        // hand-written caller treats absent as compatible (no value → no
        // feature gate to check).
        match self {
            Some(v) => v.is_compatible(browsers),
            None => true,
        }
    }
}

impl<T: IsCompatible> IsCompatible for [T] {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        for item in self {
            if !item.is_compatible(browsers) {
                return false;
            }
        }
        true
    }
}

impl<T: IsCompatible, const N: usize> IsCompatible for [T; N] {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        self.as_slice().is_compatible(browsers)
    }
}

impl<T: IsCompatible> IsCompatible for Vec<T> {
    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        self.as_slice().is_compatible(browsers)
    }
}

// The Zig original blanket-impls over "any list container". A Rust blanket
// `impl<L: ListContainer>` conflicts with the `&T` impl above (coherence can't
// prove `&T` never impls `ListContainer`), so spell out the three concrete
// container types instead.
macro_rules! is_compatible_container {
    ($(($($gen:tt)*) $ty:ty),* $(,)?) => {$(
        impl<$($gen)*> IsCompatible for $ty
        where
            <$ty as ListContainer>::Item: IsCompatible,
        {
            fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
                for item in ListContainer::slice(self) {
                    if !item.is_compatible(browsers) {
                        return false;
                    }
                }
                true
            }
        }
    )*};
}
is_compatible_container!(
    ('bump, T) ArrayList<'bump, T>,
    (T) BabyList<T>,
    (T, const N: usize) SmallList<T, N>,
);

// ───────────────────────────────────────────────────────────────────────────────
// Parse / ParseWithOptions
// ───────────────────────────────────────────────────────────────────────────────
// Zig's `generic.parse(T, input)` / `generic.parseWithOptions(T, input, opts)`
// dispatch via `@hasDecl(T, "parse"[WithOptions])`. In Rust each leaf value
// type either hand-writes an inherent `parse(&mut Parser) -> CssResult<Self>`
// or derives one via `#[derive(Parse)]` / `#[derive(DefineEnumProperty)]`; the
// trait below is the uniform bound that `Property::parse` and the container
// blanket impls (`SmallList`/`BabyList`/`Option`/`Size2D`/`Rect`) need.
//
// `Parse` is intentionally lifetime-free: every value-type parser takes
// `&mut Parser<'_>` (the borrowed source slice) and returns an owned value.
// `'bump` arena threading is a Phase-B follow-up; until then the parser holds
// the arena and arena-backed lists go through `from_list(Vec)`.

/// `T::parse(&mut Parser) -> CssResult<T>`.
pub trait Parse: Sized {
    fn parse(input: &mut Parser) -> CssResult<Self>;
}

/// `T::parse_with_options(&mut Parser, &ParserOptions) -> CssResult<T>`.
///
/// Zig falls through to `parse` when a type has no `parseWithOptions` decl.
/// Here that's the trait's *default method* — leaf impls only override when the
/// type actually consumes options (e.g. CSS-modules `Composes`, `TokenList`).
pub trait ParseWithOptions: Sized {
    fn parse_with_options(input: &mut Parser, options: &ParserOptions) -> CssResult<Self>;
}

#[inline]
pub fn parse_with_options<T: ParseWithOptions>(
    input: &mut Parser,
    options: &ParserOptions,
) -> CssResult<T> {
    T::parse_with_options(input, options)
}

#[inline]
pub fn parse<T: Parse>(input: &mut Parser) -> CssResult<T> {
    T::parse(input)
}

#[inline]
pub fn parse_for<T: Parse>() -> fn(&mut Parser) -> CssResult<T> {
    |input| T::parse(input)
}

// ── container / primitive Parse impls ────────────────────────────────────────

impl<T: Parse> Parse for Option<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        Ok(input.try_parse(T::parse).ok())
    }
}

impl<T: Parse> Parse for Vec<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        input.parse_comma_separated(T::parse)
    }
}

impl<T: Parse, const N: usize> Parse for SmallList<T, N> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        input.parse_comma_separated(T::parse).map(SmallList::from_list)
    }
}
impl<T: Parse, const N: usize> ParseWithOptions for SmallList<T, N> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

impl<T: Parse> Parse for BabyList<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        input.parse_comma_separated(T::parse).map(BabyList::move_from_list)
    }
}
impl<T: Parse> ParseWithOptions for BabyList<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

impl<T: Parse + Clone + PartialEq> Parse for Size2D<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        Size2D::<T>::parse(input)
    }
}
impl<T: Parse + Clone + PartialEq> ParseWithOptions for Size2D<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        Size2D::<T>::parse(input)
    }
}

impl<T: Parse + Clone> Parse for Rect<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        Rect::<T>::parse(input)
    }
}
impl<T: Parse + Clone> ParseWithOptions for Rect<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        Rect::<T>::parse(input)
    }
}

impl Parse for f32 {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        CSSNumberFns::parse(input)
    }
}
impl Parse for CSSInteger {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        CSSIntegerFns::parse(input)
    }
}
impl Parse for CustomIdent {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        CustomIdentFns::parse(input)
    }
}
impl Parse for DashedIdent {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        DashedIdentFns::parse(input)
    }
}
impl Parse for Ident {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        IdentFns::parse(input)
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// ToCss
// ───────────────────────────────────────────────────────────────────────────────

pub trait ToCss {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr>;
}

#[inline]
pub fn to_css<T: ToCss>(this: &T, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
    this.to_css(dest)
}

pub fn has_to_css<T>() -> bool {
    // TODO(port): becomes `T: ToCss` bound; stub for diff parity.
    true
}

impl<T: ToCss + ?Sized> ToCss for &T {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        (**self).to_css(dest)
    }
}

impl<T: ToCss> ToCss for Option<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if let Some(val) = self {
            return val.to_css(dest);
        }
        Ok(())
    }
}

impl<'bump, T: ToCss> ToCss for ArrayList<'bump, T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::to_css::from_list(self.as_slice(), dest)
    }
}

impl<T: ToCss> ToCss for Vec<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::to_css::from_list(self.as_slice(), dest)
    }
}

impl<T: ToCss, const N: usize> ToCss for SmallList<T, N> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::to_css::from_list(self.slice(), dest)
    }
}

impl<T: ToCss> ToCss for BabyList<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::to_css::from_list(self.slice(), dest)
    }
}

impl<T: ToCss + Clone + PartialEq> ToCss for Size2D<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        Size2D::<T>::to_css(self, dest)
    }
}

impl<T: ToCss + PartialEq> ToCss for Rect<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        Rect::<T>::to_css(self, dest)
    }
}

impl ToCss for f32 {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(self, dest)
    }
}
impl ToCss for CSSInteger {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSIntegerFns::to_css(self, dest)
    }
}
impl ToCss for CustomIdent {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CustomIdentFns::to_css(self, dest)
    }
}
impl ToCss for DashedIdent {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        DashedIdentFns::to_css(self, dest)
    }
}
impl ToCss for Ident {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        IdentFns::to_css(self, dest)
    }
}

// ── leaf-type forwarding macro ───────────────────────────────────────────────
// Every CSS leaf value type carries inherent `parse` / `to_css` (hand-written
// or derived). This macro batch-registers them as `generic::{Parse,ToCss,
// ParseWithOptions}` impls so `Property::{parse,value_to_css}` can dispatch
// uniformly. `ParseWithOptions` ignores options (Zig fallthrough); types that
// genuinely consume options override with a hand-written impl instead of
// listing themselves here.
#[macro_export]
macro_rules! impl_generic_parse_tocss {
    ($($ty:ty),+ $(,)?) => {$(
        impl $crate::generics::Parse for $ty {
            #[inline]
            fn parse(input: &mut $crate::css_parser::Parser) -> $crate::css_parser::CssResult<Self> {
                <$ty>::parse(input)
            }
        }
        impl $crate::generics::ParseWithOptions for $ty {
            #[inline]
            fn parse_with_options(
                input: &mut $crate::css_parser::Parser,
                _options: &$crate::css_parser::ParserOptions,
            ) -> $crate::css_parser::CssResult<Self> {
                <$ty>::parse(input)
            }
        }
        impl $crate::generics::ToCss for $ty {
            #[inline]
            fn to_css(
                &self,
                dest: &mut $crate::printer::Printer,
            ) -> ::core::result::Result<(), $crate::PrintErr> {
                <$ty>::to_css(self, dest)
            }
        }
    )+};
    // `@stub` arm: the leaf type's inherent `parse`/`to_css` is still
    // `#[cfg(any())]`-gated (its body bottoms out on a not-yet-ported helper).
    // Emitting a `todo!()` trait body lets `Property::{parse,value_to_css}`
    // compile end-to-end now; the stub becomes a forwarding impl when the
    // inherent un-gates (move the type to the plain arm above).
    (@stub $($ty:ty),+ $(,)?) => {$(
        impl $crate::generics::Parse for $ty {
            #[inline]
            fn parse(_input: &mut $crate::css_parser::Parser) -> $crate::css_parser::CssResult<Self> {
                todo!(concat!("blocked_on: ", stringify!($ty), "::parse — inherent body still #[cfg(any())]-gated"))
            }
        }
        impl $crate::generics::ParseWithOptions for $ty {
            #[inline]
            fn parse_with_options(
                _input: &mut $crate::css_parser::Parser,
                _options: &$crate::css_parser::ParserOptions,
            ) -> $crate::css_parser::CssResult<Self> {
                todo!(concat!("blocked_on: ", stringify!($ty), "::parse — inherent body still #[cfg(any())]-gated"))
            }
        }
        impl $crate::generics::ToCss for $ty {
            #[inline]
            fn to_css(
                &self,
                _dest: &mut $crate::printer::Printer,
            ) -> ::core::result::Result<(), $crate::PrintErr> {
                todo!(concat!("blocked_on: ", stringify!($ty), "::to_css — inherent body still #[cfg(any())]-gated"))
            }
        }
    )+};
}

/// `ParseWithOptions` for primitives — same fallthrough as the macro, but
/// listed once rather than duplicated per call site.
macro_rules! impl_pwo_via_parse {
    ($($ty:ty),+ $(,)?) => {$(
        impl ParseWithOptions for $ty {
            #[inline]
            fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
                <$ty as Parse>::parse(input)
            }
        }
    )+};
}
impl_pwo_via_parse!(f32, CSSInteger, CustomIdent, DashedIdent, Ident);

// ───────────────────────────────────────────────────────────────────────────────
// Numeric helpers (tryFromAngle / trySign / tryMap / tryOp / tryOpTo / partialCmp)
// ───────────────────────────────────────────────────────────────────────────────

pub trait TryFromAngle: Sized {
    fn try_from_angle(angle: Angle) -> Option<Self>;
}

#[inline]
pub fn try_from_angle<T: TryFromAngle>(angle: Angle) -> Option<T> {
    T::try_from_angle(angle)
}

impl TryFromAngle for CSSNumber {
    #[inline]
    fn try_from_angle(angle: Angle) -> Option<Self> {
        CSSNumberFns::try_from_angle(angle)
    }
}

pub trait TrySign {
    fn try_sign(&self) -> Option<f32>;
}

#[inline]
pub fn try_sign<T: TrySign>(val: &T) -> Option<f32> {
    val.try_sign()
}

impl TrySign for CSSNumber {
    #[inline]
    fn try_sign(&self) -> Option<f32> {
        Some(CSSNumberFns::sign(self))
    }
}
// TODO(port): Zig fallback `if @hasDecl(T, "sign") T.sign else T.trySign` —
// model as a trait with default method delegating to `Sign` where available.

pub trait TryMap: Sized {
    // Zig: `comptime map_fn: *const fn(f32) f32` — generic param preserves monomorphization.
    fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self>;
}

#[inline]
pub fn try_map<T: TryMap>(val: &T, map_fn: impl Fn(f32) -> f32) -> Option<T> {
    val.try_map(map_fn)
}

impl TryMap for CSSNumber {
    #[inline]
    fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self> {
        Some(map_fn(*self))
    }
}

pub trait TryOpTo<R>: Sized {
    // Zig: `comptime op_fn: *const fn(...)` — generic param preserves monomorphization.
    fn try_op_to<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R>;
}

#[inline]
pub fn try_op_to<T: TryOpTo<R>, R, C>(
    lhs: &T,
    rhs: &T,
    ctx: C,
    op_fn: impl Fn(C, f32, f32) -> R,
) -> Option<R> {
    lhs.try_op_to(rhs, ctx, op_fn)
}

impl<R> TryOpTo<R> for CSSNumber {
    #[inline]
    fn try_op_to<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R> {
        Some(op_fn(ctx, *self, *rhs))
    }
}

pub trait TryOp: Sized {
    // Zig: `comptime op_fn: *const fn(...)` — generic param preserves monomorphization.
    fn try_op<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<Self>;
}

#[inline]
pub fn try_op<T: TryOp, C>(lhs: &T, rhs: &T, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<T> {
    lhs.try_op(rhs, ctx, op_fn)
}

impl TryOp for CSSNumber {
    #[inline]
    fn try_op<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<Self> {
        Some(op_fn(ctx, *self, *rhs))
    }
}

pub trait PartialCmp {
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering>;
}

#[inline]
pub fn partial_cmp<T: PartialCmp>(lhs: &T, rhs: &T) -> Option<Ordering> {
    lhs.partial_cmp(rhs)
}

#[inline]
pub fn partial_cmp_f32(lhs: &f32, rhs: &f32) -> Option<Ordering> {
    let lte = *lhs <= *rhs;
    let rte = *lhs >= *rhs;
    if !lte && !rte {
        return None;
    }
    if !lte && rte {
        return Some(Ordering::Greater);
    }
    if lte && !rte {
        return Some(Ordering::Less);
    }
    Some(Ordering::Equal)
}

impl PartialCmp for f32 {
    #[inline]
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        partial_cmp_f32(self, rhs)
    }
}
impl PartialCmp for CSSInteger {
    #[inline]
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Some(Ord::cmp(self, rhs))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/generics.zig (674 lines)
//   confidence: medium
//   todos:      9
//   notes:      Heavy @typeInfo reflection reshaped into traits + blanket impls;
//               per-type derives `#[derive(DeepClone, CssEql, CssHash)]` are
//               implemented in `bun_css_derive` and re-exported here (same-name
//               trait+derive idiom). ParseWithOptions blanket uses
//               specialization.
// ──────────────────────────────────────────────────────────────────────────
