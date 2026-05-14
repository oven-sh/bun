//! Generic trait-based dispatch for CSS value operations.
//!
//! The Zig original (`generics.zig`) uses `@typeInfo`/`@hasDecl`/`@field` comptime
//! reflection to derive `eql`, `hash`, `deepClone`, `toCss`, `parse`, etc. across
//! every CSS value type. Per PORTING.md §Comptime reflection, that has no Rust
//! equivalent — the port defines a trait per protocol, provides blanket impls for
//! the structural cases (Option/Box/slice/Vec/Vec/SmallList/primitives), and
//! per-struct/-enum impls are expected to come from `#[derive(...)]` macros in
//! Phase B (`#[derive(ToCss, DeepClone, CssEql, CssHash)]` etc.).
//!
//! Free functions with the original names are kept as thin trait-method wrappers
//! so call sites in sibling files port 1:1.

use core::cmp::Ordering;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::VecExt;
// Zig `std.hash.Wyhash` (iterative) → `bun_wyhash::Wyhash` (the final4 variant
// matching upstream `std.hash.Wyhash`; NOT `Wyhash11`, which is a legacy v0.11
// variant kept only for on-disk lockfile compat — different digest).
// Re-exported `pub` so `#[derive(CssHash)]` (in `bun_css_derive`) can name the
// hasher type as `::bun_css::generics::Wyhash` without depending on `bun_wyhash`
// directly.
pub use bun_wyhash::Wyhash;

use crate::SmallList;
use crate::css_parser as css;
use crate::css_parser::CssResult;
use crate::css_parser::{Parser, ParserOptions};
use crate::printer::Printer;
use crate::values as css_values;
use crate::values::angle::Angle;
use crate::values::ident::{
    CustomIdent, CustomIdentFns, DashedIdent, DashedIdentFns, Ident, IdentFns,
};
use crate::values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use crate::values::rect::Rect;
use crate::values::size::Size2D;
use crate::{PrintErr, VendorPrefix};

// `ArrayList(T)` in the Zig is `std.ArrayListUnmanaged(T)` fed the parser arena.
// In this AST crate that maps to `bun_alloc::ArenaVec<'bump, T>`.
pub type ArrayList<'bump, T> = bun_alloc::ArenaVec<'bump, T>;

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

// Alias: in Zig `deepClone` (structural type-dispatch entry) and
// `implementDeepClone` (field-reflection body) are distinct, but in Rust both
// collapse to `T::deep_clone` because the structural dispatch lives in the
// blanket impls below and the field-reflection lives in `#[derive(DeepClone)]`.
// Kept as a re-export so generated code (`properties_generated.rs`) and
// hand-written callers can use either name.
pub use implement_deep_clone as deep_clone;

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
        // Zig: `bun.create(arena, TT, deepClone(TT, this.*, arena))`
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
        // Zig: `css.deepClone(T, arena, this)` → alloc capacity, element-wise deepClone.
        // PERF(port): Zig fast-paths simple-copy types with @memcpy — profile in Phase B.
        let mut out = ArrayList::with_capacity_in(self.len(), bump);
        for item in self.iter() {
            out.push(item.deep_clone(bump));
        }
        out
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Vec<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // `Vec::deep_clone_with` takes a per-element closure so the arena
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

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Box<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        Box::new((**self).deep_clone(bump))
    }
}

impl<'bump> DeepClone<'bump> for bun_ast::Loc {
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

impl<T: CssEql> CssEql for Vec<T> {
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

/// Stamp `impl CssEql for $T` forwarding to `PartialEq::eq`.
///
/// Exported sibling of `eql_simple!` for crate-defined types whose Phase-A
/// inherent `pub fn eql(&self, other) { self == other }` was a pure `PartialEq`
/// forwarder (Zig `css.implementEql(@This())` leakage).
///
/// Unlike `#[derive(CssEql)]` (field-wise `.eql()` walk), this does **not**
/// require every field type to itself impl `CssEql`; it bridges
/// `PartialEq` → `CssEql` wholesale. Prefer `#[derive(CssEql)]` only when a
/// field's `CssEql` is intentionally *different* from its `PartialEq` (e.g.
/// `Ident`, `Url`).
///
/// REJECTED alternative: `impl<T: PartialEq> CssEql for T {}` blanket — would
/// overlap the existing `Option<T>`/`Vec<T>`/`[T]`/`Box<T>` blanket impls
/// above (coherence).
#[macro_export]
macro_rules! css_eql_partialeq {
    ($($t:ty),+ $(,)?) => {$(
        impl $crate::generics::CssEql for $t {
            #[inline]
            fn eql(&self, other: &Self) -> bool { self == other }
        }
    )+};
}
pub use css_eql_partialeq;

impl CssEql for [u8] {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_core::eql(self, other)
    }
}

impl CssEql for str {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_core::eql(self.as_bytes(), other.as_bytes())
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

impl CssEql for bun_ast::Loc {
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
                    // `.v()` borrows the parser arena (see `crate::arena_str`).
                    bun_core::eql(self.v(), other.v())
                }
            }
        )*};
    }
    ident_eql_impl!(CustomIdent, DashedIdent, Ident);
}

// ───────────────────────────────────────────────────────────────────────────────
// Bridge inherent eql/hash/deep_clone → trait impls
//
// Many CSS value types carry hand-rolled inherent `eql`/`hash`/`deep_clone`
// (ported verbatim from the Zig `implementEql`/`implementHash`/
// `implementDeepClone` bodies — usually because a field is a raw `*const [u8]`
// arena slice that the derive can't see through). The `#[derive(CssEql/…)]`
// expansion on *containing* types dispatches via UFCS trait paths, so those
// inherent methods alone don't satisfy the bound. These thin forwarding impls
// close the gap without duplicating logic.
mod inherent_bridge {
    use super::{Arena, CssEql, CssHash, DeepClone, Wyhash};

    macro_rules! bridge_eql {
        ($($t:ty),* $(,)?) => {$(
            impl CssEql for $t {
                #[inline]
                fn eql(&self, other: &Self) -> bool { <$t>::eql(self, other) }
            }
        )*};
    }
    macro_rules! bridge_hash {
        ($($t:ty),* $(,)?) => {$(
            impl CssHash for $t {
                #[inline]
                fn hash(&self, hasher: &mut Wyhash) { <$t>::hash(self, hasher) }
            }
        )*};
    }
    macro_rules! bridge_deep_clone {
        ($($t:ty),* $(,)?) => {$(
            impl<'bump> DeepClone<'bump> for $t {
                #[inline]
                fn deep_clone(&self, bump: &'bump Arena) -> Self { <$t>::deep_clone(self, bump) }
            }
        )*};
    }
    macro_rules! bridge_deep_clone_copy {
        ($($t:ty),* $(,)?) => {$(
            impl<'bump> DeepClone<'bump> for $t {
                #[inline]
                fn deep_clone(&self, _bump: &'bump Arena) -> Self { Clone::clone(self) }
            }
        )*};
    }

    use crate::values::ident::{CustomIdent, DashedIdent, DashedIdentReference, Ident};
    bridge_hash!(CustomIdent, DashedIdent, Ident, DashedIdentReference);
    bridge_eql!(DashedIdentReference);
    bridge_deep_clone!(CustomIdent, DashedIdent, Ident, DashedIdentReference);

    use crate::values::color::CssColor;
    bridge_hash!(CssColor);
    bridge_deep_clone!(CssColor);

    use crate::values::url::Url;
    bridge_eql!(Url);
    bridge_hash!(Url);
    bridge_deep_clone!(Url);

    use crate::properties::animation::AnimationName;
    bridge_eql!(AnimationName);
    bridge_hash!(AnimationName);
    bridge_deep_clone!(AnimationName);

    use crate::properties::custom::UAEnvironmentVariable;
    bridge_eql!(UAEnvironmentVariable);
    // CssHash — via #[derive(CssHash)] on the enum (properties/custom.rs).
    bridge_deep_clone!(UAEnvironmentVariable);

    // `Direction` is re-exported from `properties::text` — bridged below as `TextDirection`.
    use crate::selectors::parser::{ViewTransitionPartName, WebKitScrollbarPseudoElement};
    bridge_eql!(WebKitScrollbarPseudoElement, ViewTransitionPartName);
    // CssHash for WebKitScrollbarPseudoElement — via #[derive(CssHash)] on the enum.
    bridge_hash!(ViewTransitionPartName);
    bridge_deep_clone_copy!(WebKitScrollbarPseudoElement, ViewTransitionPartName);

    // ───────────────────────────────────────────────────────────────────────
    // Property value-type bridges — `Property::deep_clone`/`eql` dispatch via
    // `css::generic::deep_clone`/`eql` (trait bounds), but most leaf types
    // only carry inherent methods or `derive(Clone, PartialEq)`. Bridge them.
    // ───────────────────────────────────────────────────────────────────────

    /// Forward `CssEql` to `PartialEq`.
    macro_rules! bridge_eql_partialeq {
        ($($t:ty),* $(,)?) => {$(
            impl CssEql for $t {
                #[inline]
                fn eql(&self, other: &Self) -> bool { PartialEq::eq(self, other) }
            }
        )*};
    }
    /// Forward `IsCompatible` to inherent `is_compatible`.
    macro_rules! bridge_is_compatible {
        ($($t:ty),* $(,)?) => {$(
            impl super::IsCompatible for $t {
                #[inline]
                fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool {
                    <$t>::is_compatible(self, browsers)
                }
            }
        )*};
    }
    /// Combo: `Clone` → `DeepClone`, `PartialEq` → `CssEql`.
    macro_rules! bridge_clone_partialeq {
        ($($t:ty),* $(,)?) => {
            bridge_deep_clone_copy!($($t),*);
            bridge_eql_partialeq!($($t),*);
        };
    }

    // ── values/ ──
    use crate::values::length::{Length, LengthOrNumber, LengthPercentageOrAuto};
    bridge_clone_partialeq!(LengthPercentageOrAuto, LengthOrNumber, Length);
    bridge_is_compatible!(LengthPercentageOrAuto, LengthOrNumber, Length);

    use crate::values::easing::EasingFunction;
    bridge_clone_partialeq!(EasingFunction);

    use crate::values::alpha::AlphaValue;
    bridge_clone_partialeq!(AlphaValue);

    use crate::values::image::Image;
    bridge_eql!(Image);
    bridge_deep_clone!(Image);
    bridge_is_compatible!(Image);
    // Gradient payload structs only carry inherent `deep_clone`; bridge them so
    // `#[derive(css::DeepClone)]` on `Gradient` / `WebKitGradient` (UFCS trait
    // dispatch) resolves.
    use crate::values::gradient::{
        ConicGradient, LinearGradient, RadialGradient, WebKitGradientLinear, WebKitGradientRadial,
    };
    bridge_deep_clone!(
        LinearGradient,
        RadialGradient,
        ConicGradient,
        WebKitGradientLinear,
        WebKitGradientRadial
    );

    use crate::values::position::{
        HorizontalPositionKeyword, Position, PositionComponent, VerticalPositionKeyword,
    };
    bridge_clone_partialeq!(Position, HorizontalPositionKeyword, VerticalPositionKeyword);
    // `PositionComponent<S>` is generic, so `bridge_clone_partialeq!` (which
    // takes concrete `ty`s) can't cover it — spell the trivial impls out.
    impl<S: Clone + PartialEq> CssEql for PositionComponent<S> {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            PartialEq::eq(self, other)
        }
    }
    impl<'bump, S: Clone + PartialEq> DeepClone<'bump> for PositionComponent<S> {
        #[inline]
        fn deep_clone(&self, _bump: &'bump Arena) -> Self {
            Clone::clone(self)
        }
    }

    use crate::values::rect::Rect;
    impl<T: PartialEq> CssEql for Rect<T> {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            Rect::<T>::eql(self, other)
        }
    }
    impl<'bump, T: Clone> DeepClone<'bump> for Rect<T> {
        #[inline]
        fn deep_clone(&self, bump: &'bump Arena) -> Self {
            Rect::<T>::deep_clone(self, bump)
        }
    }

    use crate::values::size::Size2D;
    impl<T: Clone + PartialEq> CssEql for Size2D<T> {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            Size2D::<T>::eql(self, other)
        }
    }
    impl<'bump, T: Clone + PartialEq> DeepClone<'bump> for Size2D<T> {
        #[inline]
        fn deep_clone(&self, bump: &'bump Arena) -> Self {
            Size2D::<T>::deep_clone(self, bump)
        }
    }

    bridge_is_compatible!(CssColor);

    // ── properties/border ──
    use crate::properties::border::{
        BorderBlockColor, BorderBlockStyle, BorderBlockWidth, BorderColor, BorderInlineColor,
        BorderInlineStyle, BorderInlineWidth, BorderSideWidth, BorderStyle, BorderWidth,
        GenericBorder, LineStyle,
    };
    bridge_eql_partialeq!(LineStyle);
    bridge_deep_clone!(BorderSideWidth);
    bridge_deep_clone_copy!(LineStyle);
    bridge_is_compatible!(BorderSideWidth, LineStyle);
    bridge_clone_partialeq!(
        BorderColor,
        BorderStyle,
        BorderWidth,
        BorderBlockColor,
        BorderBlockStyle,
        BorderBlockWidth,
        BorderInlineColor,
        BorderInlineStyle,
        BorderInlineWidth,
    );
    impl<S: CssEql, const P: u8> CssEql for GenericBorder<S, P> {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            self.width.eql(&other.width)
                && self.style.eql(&other.style)
                && self.color.eql(&other.color)
        }
    }
    impl<'bump, S: DeepClone<'bump>, const P: u8> DeepClone<'bump> for GenericBorder<S, P> {
        #[inline]
        fn deep_clone(&self, bump: &'bump Arena) -> Self {
            GenericBorder {
                width: self.width.deep_clone(bump),
                style: self.style.deep_clone(bump),
                color: self.color.deep_clone(bump),
            }
        }
    }

    use crate::properties::outline::OutlineStyle;
    bridge_clone_partialeq!(OutlineStyle);

    use crate::properties::border_image::{
        BorderImage, BorderImageRepeat, BorderImageSideWidth, BorderImageSlice,
    };
    // PORT NOTE: BorderImageRepeat/SideWidth/Slice carry inherent
    // `deep_clone(&self, &Arena)` / `eql(&self, &Self)` (no `Clone`/`PartialEq`
    // derives — see border_image.rs), so route through bridge_deep_clone/eql.
    bridge_deep_clone!(BorderImageRepeat, BorderImageSideWidth, BorderImageSlice);
    bridge_eql!(BorderImageRepeat, BorderImageSlice);
    bridge_deep_clone!(BorderImage);
    bridge_eql!(BorderImage);

    use crate::properties::border_radius::BorderRadius;
    // PORT NOTE: BorderRadius has inherent deep_clone/eql (Size2D<T> lacks
    // Clone/PartialEq derives — see border_radius.rs PORT NOTE).
    bridge_deep_clone!(BorderRadius);
    bridge_eql!(BorderRadius);

    // ── properties/background ──
    use crate::properties::background::{
        Background, BackgroundAttachment, BackgroundClip, BackgroundOrigin, BackgroundPosition,
        BackgroundRepeat, BackgroundSize,
    };
    bridge_eql!(Background);
    bridge_deep_clone!(
        Background,
        BackgroundSize,
        BackgroundPosition,
        BackgroundRepeat
    );
    bridge_clone_partialeq!(BackgroundAttachment, BackgroundClip, BackgroundOrigin);

    // ── properties/align ──
    use crate::properties::align::{
        AlignContent, AlignItems, AlignSelf, Gap, GapValue, JustifyContent, JustifyItems,
        JustifySelf, PlaceContent, PlaceItems, PlaceSelf,
    };
    bridge_clone_partialeq!(
        AlignContent,
        AlignItems,
        AlignSelf,
        JustifyContent,
        JustifyItems,
        JustifySelf,
        PlaceContent,
        PlaceItems,
        PlaceSelf,
        Gap,
        GapValue,
    );

    // ── properties/flex ──
    use crate::properties::flex::{
        BoxAlign, BoxDirection, BoxLines, BoxOrient, BoxPack, Flex, FlexDirection, FlexFlow,
        FlexItemAlign, FlexLinePack, FlexPack, FlexWrap,
    };
    bridge_clone_partialeq!(
        FlexDirection,
        FlexWrap,
        FlexFlow,
        Flex,
        BoxOrient,
        BoxDirection,
        BoxAlign,
        BoxPack,
        BoxLines,
        FlexPack,
        FlexItemAlign,
        FlexLinePack,
    );

    // ── properties/font ──
    use crate::properties::font::{
        FontFamily, FontSize, FontStretch, FontStyle, FontVariantCaps, FontWeight, LineHeight,
    };
    bridge_clone_partialeq!(
        FontWeight,
        FontSize,
        FontStretch,
        FontStyle,
        FontVariantCaps,
        LineHeight,
    );
    bridge_is_compatible!(
        FontWeight,
        FontSize,
        FontStretch,
        FontStyle,
        FontVariantCaps,
        LineHeight,
        FontFamily,
    );
    bridge_clone_partialeq!(FontFamily);
    // `Font` DeepClone/CssEql now via `#[derive]` on the struct (properties/font.rs).

    // ── properties/size ──
    use crate::properties::size::{AspectRatio, BoxSizing, MaxSize, Size};
    bridge_eql!(Size, MaxSize, AspectRatio);
    bridge_deep_clone!(Size, MaxSize, AspectRatio);
    bridge_clone_partialeq!(BoxSizing);

    // ── properties/display ──
    use crate::properties::display::{Display, Visibility};
    bridge_deep_clone!(Display);
    bridge_eql_partialeq!(Display);
    bridge_clone_partialeq!(Visibility);

    // ── properties/overflow ──
    use crate::properties::overflow::{Overflow, OverflowKeyword, TextOverflow};
    bridge_eql!(Overflow);
    bridge_deep_clone!(Overflow);
    bridge_clone_partialeq!(OverflowKeyword, TextOverflow);

    // ── properties/position ──
    use crate::properties::position::Position as PositionProp;
    bridge_clone_partialeq!(PositionProp);

    // ── properties/text ──
    use crate::properties::text::{Direction as TextDirection, TextShadow};
    bridge_clone_partialeq!(TextDirection);
    // CssHash for TextDirection — via #[derive(CssHash)] on the enum (properties/text.rs).
    bridge_deep_clone!(TextShadow);
    bridge_eql_partialeq!(TextShadow);

    // ── properties/transform ──
    use crate::properties::transform::{
        BackfaceVisibility, Perspective, Rotate, Scale, TransformBox, TransformList,
        TransformStyle, Translate,
    };
    bridge_deep_clone!(TransformList, Translate, Rotate, Scale, Perspective);
    // Unit enums via DefineEnumProperty — no inherent eql/deep_clone, route through Copy/PartialEq.
    bridge_clone_partialeq!(TransformStyle, TransformBox, BackfaceVisibility);

    // ── properties/transition ──
    use crate::properties::transition::Transition;
    bridge_deep_clone!(Transition);
    bridge_eql!(Transition);

    // ── properties/masking ──
    use crate::properties::masking::{
        GeometryBox, MaskBorderMode, MaskClip, MaskComposite, MaskMode, MaskType,
        WebKitMaskComposite, WebKitMaskSourceType,
    };
    bridge_clone_partialeq!(
        GeometryBox,
        MaskMode,
        MaskClip,
        MaskComposite,
        MaskType,
        MaskBorderMode,
        WebKitMaskComposite,
        WebKitMaskSourceType,
    );
    // `Mask`/`MaskBorder` DeepClone/CssEql now via `#[derive]` on the structs
    // (properties/masking.rs).

    // ── properties/ui ──
    use crate::properties::ui::ColorScheme;
    bridge_deep_clone!(ColorScheme);
    bridge_eql_partialeq!(ColorScheme);

    // ── properties/css_modules ──
    use crate::properties::css_modules::Composes;
    bridge_deep_clone!(Composes);
    bridge_eql!(Composes);

    // ── properties/margin_padding ──
    use crate::properties::margin_padding::{
        Inset, InsetBlock, InsetInline, Margin, MarginBlock, MarginInline, Padding, PaddingBlock,
        PaddingInline, ScrollMargin, ScrollMarginBlock, ScrollMarginInline, ScrollPadding,
        ScrollPaddingBlock, ScrollPaddingInline,
    };
    bridge_clone_partialeq!(
        Margin,
        MarginBlock,
        MarginInline,
        Padding,
        PaddingBlock,
        PaddingInline,
        ScrollMargin,
        ScrollMarginBlock,
        ScrollMarginInline,
        ScrollPadding,
        ScrollPaddingBlock,
        ScrollPaddingInline,
        Inset,
        InsetBlock,
        InsetInline,
    );

    // ── properties/properties_generated ──
    use crate::properties::PropertyId;
    bridge_deep_clone_copy!(PropertyId);
    bridge_eql_partialeq!(PropertyId);
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

pub fn hash_baby_list<V: CssHash>(this: &Vec<V>, hasher: &mut Wyhash) {
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

impl<T: CssHash> CssHash for Vec<T> {
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

impl CssHash for bun_ast::Loc {
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
impl<T> ListContainer for Vec<T> {
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
// blanket impls (`SmallList`/`Vec`/`Option`/`Size2D`/`Rect`) need.
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
/// PORT NOTE: Rust can't express that as a `where Self: Parse` default method
/// — the bound becomes part of the *method signature*, so the free
/// `parse_with_options::<T>` below would require `T: Parse` even for impls
/// that override the body. Instead the fallthrough lives in
/// `impl_pwo_via_parse!`/`impl_parse_tocss_via_inherent!` and the container
/// impls; every `ParseWithOptions` impl provides the method explicitly.
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
impl<T: Parse> ParseWithOptions for Option<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

impl<T: Parse> Parse for Vec<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        input.parse_comma_separated(T::parse)
    }
}
impl<T: Parse> ParseWithOptions for Vec<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

// Zig `.pointer` arm (`generics.zig:273-279`): parse the pointee then heap-allocate.
impl<T: Parse> Parse for Box<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        T::parse(input).map(Box::new)
    }
}
impl<T: Parse> ParseWithOptions for Box<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

impl<T: Parse, const N: usize> Parse for SmallList<T, N> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        input
            .parse_comma_separated(T::parse)
            .map(SmallList::from_list)
    }
}
impl<T: Parse, const N: usize> ParseWithOptions for SmallList<T, N> {
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

// Zig `.pointer` arm (`generics.zig:338-341`): recurse into `*T` pointee.
impl<T: ToCss + ?Sized> ToCss for Box<T> {
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

// ── leaf-type forwarding macros ──────────────────────────────────────────────
// Every CSS leaf value type carries inherent `parse` / `to_css` (hand-written
// or derived). `Property::{parse,value_to_css}` dispatch through the
// `generic::{Parse,ToCss,ParseWithOptions}` *traits*, so each leaf must impl
// them.
//
// Two sources of the trait impl:
//   1. `#[derive(ToCss/Parse/DefineEnumProperty)]`
//      (bun_css_derive) — emits the trait impl directly.
//   2. Hand-written leaves — list them under `impl_parse_tocss_via_inherent!`
//      to forward the trait to the inherent.
//
// A type must use exactly one of the two; listing a derive-carrying type in
// the macro is an E0119 coherence conflict.
#[macro_export]
macro_rules! impl_parse_tocss_via_inherent {
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

pub trait TryOpTo: Sized {
    // Zig: `comptime op_fn: *const fn(...)` — generic param preserves monomorphization.
    // `R` is method-generic (not trait-generic) so `TryOpTo` can appear as a
    // supertrait bound without committing to a result type.
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R>;
}

#[inline]
pub fn try_op_to<T: TryOpTo, R, C>(
    lhs: &T,
    rhs: &T,
    ctx: C,
    op_fn: impl Fn(C, f32, f32) -> R,
) -> Option<R> {
    lhs.try_op_to(rhs, ctx, op_fn)
}

impl TryOpTo for CSSNumber {
    #[inline]
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R> {
        Some(op_fn(ctx, *self, *rhs))
    }
}

impl IsCompatible for CSSNumber {
    #[inline]
    fn is_compatible(&self, _: crate::targets::Browsers) -> bool {
        true
    }
}

pub trait TryOp: Sized {
    // Zig: `comptime op_fn: *const fn(...)` — generic param preserves monomorphization.
    fn try_op<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<Self>;
}

#[inline]
pub fn try_op<T: TryOp, C>(
    lhs: &T,
    rhs: &T,
    ctx: C,
    op_fn: impl Fn(C, f32, f32) -> f32,
) -> Option<T> {
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

// ───────────────────────────────────────────────────────────────────────────────
// Zero / MulF32 / TryAdd — numeric protocol traits used by `DimensionPercentage<D>`
// and the `CalcValue` supertrait set. Formerly duplicated in `values::protocol`;
// that module now re-exports from here.
// ───────────────────────────────────────────────────────────────────────────────

/// `D::zero()` / `d.is_zero()` — additive identity.
pub trait Zero: Sized {
    fn zero() -> Self;
    fn is_zero(&self) -> bool;
}
/// `d.mul_f32(rhs)` — scalar multiplication.
pub trait MulF32: Sized {
    fn mul_f32(self, rhs: f32) -> Self;
}
/// `d.try_add(&rhs)` — same-unit addition, `None` if incompatible.
pub trait TryAdd: Sized {
    fn try_add(&self, rhs: &Self) -> Option<Self>;
}

impl MulF32 for CSSNumber {
    #[inline]
    fn mul_f32(self, rhs: f32) -> Self {
        self * rhs
    }
}

// ported from: src/css/generics.zig
