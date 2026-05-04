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
use bun_collections::{BabyList, SmallList};
use bun_wyhash::Wyhash;

use crate::css_parser as css;
use crate::css_parser::{
    CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns, CustomIdent, CustomIdentFns, DashedIdent,
    DashedIdentFns, Ident, IdentFns, Parser, ParserOptions, PrintErr, Printer, Result, VendorPrefix,
};
use crate::values as css_values;
use crate::values::angle::Angle;

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
        css::deep_clone_list(bump, self)
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for BabyList<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        self.deep_clone_infallible(bump)
    }
}

impl<'bump, T: DeepClone<'bump>, const N: usize> DeepClone<'bump> for SmallList<T, N> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        self.deep_clone(bump)
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
deep_clone_copy!(f32, f64, i32, u32, i64, u64, usize, isize, u8, u16, bool);

impl<'bump> DeepClone<'bump> for &'bump [u8] {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        // Strings in the CSS parser are always arena allocated
        // So it is safe to skip const strings as they will never be mutated
        *self
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
        self.as_slice().eql(other.as_slice())
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
eql_simple!(f32, f64, i32, u32, i64, u64, usize, isize, u8, u16, bool);

impl CssEql for [u8] {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_str::strings::eql(self, other)
    }
}

impl CssEql for VendorPrefix {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        VendorPrefix::eql(*self, *other)
    }
}

impl CssEql for bun_logger::Loc {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self.start == other.start
    }
}

impl CssEql for CustomIdent {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_str::strings::eql(self.v, other.v)
    }
}
impl CssEql for DashedIdent {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_str::strings::eql(self.v, other.v)
    }
}
impl CssEql for Ident {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_str::strings::eql(self.v, other.v)
    }
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
        bun_core::write_any_to_hasher(hasher, self.len());
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
        self.hash(hasher)
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
hash_simple!(f32, f64, i32, u32, i64, u64, usize, isize, u8, u16);

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
        self.as_slice()
    }
}

#[inline]
pub fn slice<L: ListContainer>(val: &L) -> &[L::Item] {
    val.slice()
}

pub trait IsCompatible {
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool;
}

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

impl<L> IsCompatible for L
where
    L: ListContainer,
    L::Item: IsCompatible,
{
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
        for item in self.slice() {
            if !item.is_compatible(browsers) {
                return false;
            }
        }
        true
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Parse / ParseWithOptions
// ───────────────────────────────────────────────────────────────────────────────

pub trait Parse<'bump>: Sized {
    fn parse(input: &mut Parser<'bump>) -> Result<Self>;
}

pub trait ParseWithOptions<'bump>: Sized {
    fn parse_with_options(input: &mut Parser<'bump>, options: &ParserOptions) -> Result<Self>;
}

#[inline]
pub fn parse_with_options<'bump, T: ParseWithOptions<'bump>>(
    input: &mut Parser<'bump>,
    options: &ParserOptions,
) -> Result<T> {
    T::parse_with_options(input, options)
}

#[inline]
pub fn parse<'bump, T: Parse<'bump>>(input: &mut Parser<'bump>) -> Result<T> {
    T::parse(input)
}

#[inline]
pub fn parse_for<'bump, T: Parse<'bump>>() -> fn(&mut Parser<'bump>) -> Result<T> {
    |input| T::parse(input)
}

// Default: anything that implements `Parse` implements `ParseWithOptions` by
// ignoring options (matches Zig fallthrough to `parse`).
impl<'bump, T: Parse<'bump>> ParseWithOptions<'bump> for T {
    #[inline]
    default fn parse_with_options(input: &mut Parser<'bump>, _options: &ParserOptions) -> Result<Self> {
        // TODO(port): uses specialization (`default fn`) so types with their own
        // `parseWithOptions` can override. If specialization is unavailable in
        // Phase B, split into a separate trait with manual impls.
        T::parse(input)
    }
}

impl<'bump, T: Parse<'bump>> Parse<'bump> for &'bump T {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        match T::parse(input) {
            Result::Ok(v) => Result::Ok(input.allocator().alloc(v)),
            Result::Err(e) => Result::Err(e),
        }
    }
}

impl<'bump, T: Parse<'bump>> Parse<'bump> for Option<T> {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        Result::Ok(input.try_parse(parse_for::<T>()).as_value())
    }
}

impl<'bump, T: Parse<'bump>> Parse<'bump> for ArrayList<'bump, T> {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        input.parse_comma_separated(parse_for::<T>())
    }
}

impl<'bump> Parse<'bump> for f32 {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        CSSNumberFns::parse(input)
    }
}
impl<'bump> Parse<'bump> for CSSInteger {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        CSSIntegerFns::parse(input)
    }
}
impl<'bump> Parse<'bump> for CustomIdent {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        CustomIdentFns::parse(input)
    }
}
impl<'bump> Parse<'bump> for DashedIdent {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
        DashedIdentFns::parse(input)
    }
}
impl<'bump> Parse<'bump> for Ident {
    #[inline]
    fn parse(input: &mut Parser<'bump>) -> Result<Self> {
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

// TODO(port): Zig had `@compileError("TODO")` for BabyList/SmallList ToCss.

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
impl TryFromAngle for Angle {
    #[inline]
    fn try_from_angle(angle: Angle) -> Option<Self> {
        Angle::try_from_angle(angle)
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

impl TryOp for Angle {
    #[inline]
    fn try_op<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<Self> {
        Angle::try_op(self, rhs, ctx, op_fn)
    }
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
impl PartialCmp for css_values::angle::Angle {
    #[inline]
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        css_values::angle::Angle::partial_cmp(self, rhs)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/generics.zig (674 lines)
//   confidence: medium
//   todos:      11
//   notes:      Heavy @typeInfo reflection reshaped into traits + blanket impls; per-type derives (DeepClone/CssEql/CssHash/ToCss) needed in Phase B; ParseWithOptions blanket uses specialization.
// ──────────────────────────────────────────────────────────────────────────
