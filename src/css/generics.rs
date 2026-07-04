//! Generic trait-based dispatch for CSS value operations.
//!
//! `eql`, `hash`, `deepClone`, `toCss`, `parse`, etc. are dispatched across
//! every CSS value type via a trait per protocol, with blanket impls for
//! the structural cases (Option/Box/slice/Vec/Vec/SmallList/primitives);
//! per-struct/-enum impls come from the `bun_css_derive` proc-macros
//! (`#[derive(ToCss, DeepClone, CssEql, CssHash)]` etc.).
//!
//! Free functions with the original names are kept as thin trait-method wrappers
//! for call sites in sibling files.

use core::cmp::Ordering;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::VecExt;
// `bun_wyhash::Wyhash` is the final4 variant
// (NOT `Wyhash11`, which is a legacy
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
use crate::values::angle::Angle;
use crate::values::ident::{
    CustomIdent, CustomIdentFns, DashedIdent, DashedIdentFns, Ident, IdentFns,
};
use crate::values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use crate::values::rect::Rect;
use crate::values::size::Size2D;
use crate::{PrintErr, VendorPrefix};

// In this AST crate, lists map to `bun_alloc::ArenaVec<'bump, T>` fed the
// parser arena.
pub type ArrayList<'bump, T> = bun_alloc::ArenaVec<'bump, T>;

// ───────────────────────────────────────────────────────────────────────────────
// DeepClone
// ───────────────────────────────────────────────────────────────────────────────

/// Arena-aware deep clone.
///
/// Per-struct/-enum impls come from `#[derive(DeepClone)]` (field-wise /
/// variant-wise recursion).
pub trait DeepClone<'bump>: Sized {
    fn deep_clone(&self, bump: &'bump Arena) -> Self;
}

/// `#[derive(DeepClone)]` — field-wise / variant-wise deep clone.
/// See `src/css_derive/lib.rs` for the expansion
/// rules. Re-exported here so `use crate::generics::DeepClone;` brings both
/// the trait and the derive into scope (same-name trait+derive is the std
/// idiom, cf. `Clone`).
pub use bun_css_derive::DeepClone;

#[inline]
pub fn implement_deep_clone<'bump, T: DeepClone<'bump>>(this: &T, bump: &'bump Arena) -> T {
    this.deep_clone(bump)
}

// Alias: structural dispatch lives in the blanket impls below and the
// field-reflection lives in `#[derive(DeepClone)]`; both collapse to
// `T::deep_clone`.
// Kept as a re-export so generated code (`properties_generated.rs`) and
// hand-written callers can use either name.
pub use implement_deep_clone as deep_clone;

// Blanket impls covering the structural cases.

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for Option<T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        self.as_ref().map(|v| v.deep_clone(bump))
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for &'bump T {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        bump.alloc((**self).deep_clone(bump))
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for &'bump [T] {
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // PERF: element-wise deep_clone — profile if hot
        // (specialization would let `T: Copy` use `alloc_slice_copy`).
        bump.alloc_slice_fill_iter(self.iter().map(|e| e.deep_clone(bump)))
    }
}

impl<'bump, T: DeepClone<'bump>> DeepClone<'bump> for ArrayList<'bump, T> {
    #[inline]
    fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // PERF: element-wise deep_clone — profile if hot.
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
/// `#[derive(PartialEq)]` in Rust — and most impls could be exactly that.
/// Kept as a separate trait because some CSS types want structural
/// equality that differs from `PartialEq` (e.g. `VendorPrefix`, idents).
pub trait CssEql {
    fn eql(&self, other: &Self) -> bool;
}

/// `#[derive(CssEql)]` — field-wise / variant-wise equality.
/// See `src/css_derive/lib.rs` for the expansion rules.
/// Re-exported here so `use crate::generics::CssEql;` brings both trait and
/// derive into scope (same-name idiom, cf. `Clone`).
pub use bun_css_derive::CssEql;

#[inline]
pub fn implement_eql<T: CssEql>(this: &T, other: &T) -> bool {
    this.eql(other)
}

#[inline]
pub(crate) fn eql<T: CssEql>(lhs: &T, rhs: &T) -> bool {
    lhs.eql(rhs)
}

pub(crate) fn eql_list<T: CssEql>(lhs: &ArrayList<'_, T>, rhs: &ArrayList<'_, T>) -> bool {
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
/// Exported sibling of `eql_simple!` for crate-defined types whose
/// inherent `pub fn eql(&self, other) { self == other }` was a pure `PartialEq`
/// forwarder.
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
        bun_core::strings::eql(self, other)
    }
}

impl CssEql for str {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        bun_core::strings::eql(self.as_bytes(), other.as_bytes())
    }
}

impl<T: CssEql, const N: usize> CssEql for [T; N] {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        // Element-wise eql (length is `N` on both sides by type).
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

// `CssEql` impls for `CustomIdent`/`DashedIdent`/`Ident` (defined in
// `values/ident.rs`, which does not depend on this trait).
mod ident_eql {
    use super::CssEql;
    use crate::values::ident::{CustomIdent, DashedIdent, Ident};

    macro_rules! ident_eql_impl {
        ($($t:ty),* $(,)?) => {$(
            impl CssEql for $t {
                #[inline]
                fn eql(&self, other: &Self) -> bool {
                    // `.v()` borrows the parser arena (see `crate::arena_str`).
                    bun_core::strings::eql(self.v(), other.v())
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
// (usually because a field is a raw `*const [u8]`
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

    use crate::properties::animation::Animation;
    // `CssEql` for `Animation` via `#[derive(CssEql)]` on the struct.
    bridge_deep_clone!(Animation);

    use crate::properties::custom::UAEnvironmentVariable;
    impl CssEql for UAEnvironmentVariable {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            UAEnvironmentVariable::eql(*self, *other)
        }
    }
    // CssHash — via #[derive(CssHash)] on the enum (properties/custom.rs).
    bridge_deep_clone_copy!(UAEnvironmentVariable);

    // `Direction` is re-exported from `properties::text` — bridged below as `TextDirection`.
    use crate::selectors::parser::{ViewTransitionPartName, WebKitScrollbarPseudoElement};
    impl CssEql for WebKitScrollbarPseudoElement {
        #[inline]
        fn eql(&self, other: &Self) -> bool {
            WebKitScrollbarPseudoElement::eql(*self, *other)
        }
    }
    bridge_eql!(ViewTransitionPartName);
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
                fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
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

    use crate::properties::animation::{
        AnimationDirection, AnimationFillMode, AnimationIterationCount, AnimationPlayState,
        AnimationTimeline,
    };
    bridge_eql_partialeq!(
        AnimationIterationCount,
        AnimationDirection,
        AnimationPlayState,
        AnimationFillMode,
        AnimationTimeline,
    );

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
    impl super::IsCompatible for BorderSideWidth {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            BorderSideWidth::is_compatible(self, browsers)
        }
    }
    impl super::IsCompatible for LineStyle {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            LineStyle::is_compatible(*self, browsers)
        }
    }
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
    // BorderImageRepeat/SideWidth/Slice carry inherent
    // `deep_clone(&self, &Arena)` / `eql(&self, &Self)` (no `Clone`/`PartialEq`
    // derives — see border_image.rs), so route through bridge_deep_clone/eql.
    bridge_deep_clone!(BorderImageRepeat, BorderImageSideWidth, BorderImageSlice);
    bridge_eql!(BorderImageRepeat, BorderImageSlice);
    bridge_deep_clone!(BorderImage);
    bridge_eql!(BorderImage);

    use crate::properties::border_radius::BorderRadius;
    // BorderRadius has inherent deep_clone/eql (Size2D<T> lacks
    // Clone/PartialEq derives — see border_radius.rs).
    bridge_deep_clone!(BorderRadius);
    bridge_eql!(BorderRadius);

    // ── properties/background ──
    use crate::properties::background::{
        Background, BackgroundAttachment, BackgroundClip, BackgroundOrigin, BackgroundPosition,
        BackgroundRepeat, BackgroundSize,
    };
    bridge_eql!(Background);
    bridge_deep_clone!(Background, BackgroundSize, BackgroundPosition);
    bridge_deep_clone_copy!(BackgroundRepeat);
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
    impl super::IsCompatible for FontWeight {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontWeight::is_compatible(self, browsers)
        }
    }
    impl super::IsCompatible for FontSize {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontSize::is_compatible(self, browsers)
        }
    }
    impl super::IsCompatible for FontStretch {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontStretch::is_compatible(*self, browsers)
        }
    }
    impl super::IsCompatible for FontStyle {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontStyle::is_compatible(*self, browsers)
        }
    }
    impl super::IsCompatible for FontVariantCaps {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontVariantCaps::is_compatible(*self, browsers)
        }
    }
    impl super::IsCompatible for LineHeight {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            LineHeight::is_compatible(self, browsers)
        }
    }
    impl super::IsCompatible for FontFamily {
        #[inline]
        fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
            FontFamily::is_compatible(self, browsers)
        }
    }
    bridge_clone_partialeq!(FontFamily);
    // `Font` DeepClone/CssEql now via `#[derive]` on the struct (properties/font.rs).

    // ── properties/size ──
    use crate::properties::size::{AspectRatio, BoxSizing, MaxSize, Size};
    bridge_eql!(Size, MaxSize, AspectRatio);
    bridge_deep_clone!(Size, MaxSize, AspectRatio);
    bridge_clone_partialeq!(BoxSizing);

    // ── properties/display ──
    use crate::properties::display::{Display, Visibility};
    bridge_deep_clone_copy!(Display);
    bridge_eql_partialeq!(Display);
    bridge_clone_partialeq!(Visibility);

    // ── properties/overflow ──
    use crate::properties::overflow::{Overflow, OverflowKeyword, TextOverflow};
    bridge_clone_partialeq!(Overflow, OverflowKeyword, TextOverflow);

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
    bridge_deep_clone_copy!(ColorScheme);
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

// Packed bitfields are `bitflags!` types whose derived `PartialEq` already
// compares contents, routed through the per-type `bridge_eql_partialeq!` calls above.
// (A blanket `impl<T: bitflags::Flags> CssEql for T` would collide with the container
// blanket impls under coherence, so coverage stays per-type.)

// ───────────────────────────────────────────────────────────────────────────────
// Hash
// ───────────────────────────────────────────────────────────────────────────────

pub const HASH_SEED: u64 = 0;

/// Wyhash-based structural hash for CSS values.
pub trait CssHash {
    fn hash(&self, hasher: &mut Wyhash);
}

/// `#[derive(CssHash)]` — field-wise / variant-wise hashing.
/// See `src/css_derive/lib.rs` for the expansion rules.
/// Re-exported here so `use crate::generics::CssHash;` brings both trait and
/// derive into scope.
pub use bun_css_derive::CssHash;

#[inline]
pub fn implement_hash<T: CssHash>(this: &T, hasher: &mut Wyhash) {
    this.hash(hasher)
}

#[inline]
pub fn hash<T: CssHash>(this: &T, hasher: &mut Wyhash) {
    this.hash(hasher)
}

pub(crate) fn hash_array_list<V: CssHash>(this: &ArrayList<'_, V>, hasher: &mut Wyhash) {
    for item in this.iter() {
        item.hash(hasher);
    }
}

pub(crate) fn hash_baby_list<V: CssHash>(this: &Vec<V>, hasher: &mut Wyhash) {
    for item in this.slice_const() {
        item.hash(hasher);
    }
}

impl CssHash for () {
    #[inline]
    fn hash(&self, _hasher: &mut Wyhash) {}
}

impl<T: CssHash> CssHash for Option<T> {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        // Some → hash inner, None → no-op. Do NOT emit "null"/"some"
        // prefixes here.
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
        // Iterates items only — no len prefix.
        for item in self {
            item.hash(hasher);
        }
    }
}

impl<T: CssHash, const N: usize> CssHash for [T; N] {
    fn hash(&self, hasher: &mut Wyhash) {
        // Feed the raw bytes
        // of the `usize` length into the hasher. `bun_core::write_any_to_hasher` exists
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
        hasher.update(&[self.as_bits()]);
    }
}

impl CssHash for bun_ast::Loc {
    #[inline]
    fn hash(&self, hasher: &mut Wyhash) {
        // Providing a structural hash here lets `#[derive(CssHash)]` types
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
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool;
}

/// `#[derive(IsCompatible)]` — field-wise / variant-wise port of the
/// hand-written `isCompatible` pattern (struct → AND of fields, enum → unit
/// variants `true` / payload variants delegate). See `src/css_derive/lib.rs`.
/// Re-exported here so `use crate::generics::IsCompatible;` brings both trait
/// and derive into scope.
pub use bun_css_derive::IsCompatible;

#[inline]
pub(crate) fn is_compatible<T: IsCompatible>(val: &T, browsers: &crate::targets::Browsers) -> bool {
    val.is_compatible(browsers)
}

impl<T: IsCompatible + ?Sized> IsCompatible for &T {
    #[inline]
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        (**self).is_compatible(browsers)
    }
}

impl<T: IsCompatible + ?Sized> IsCompatible for Box<T> {
    #[inline]
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        (**self).is_compatible(browsers)
    }
}

impl<T: IsCompatible> IsCompatible for Option<T> {
    #[inline]
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        // Every hand-written caller treats absent as compatible (no value →
        // no feature gate to check).
        match self {
            Some(v) => v.is_compatible(browsers),
            None => true,
        }
    }
}

impl<T: IsCompatible> IsCompatible for [T] {
    #[inline]
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
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
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        self.as_slice().is_compatible(browsers)
    }
}

impl<T: IsCompatible> IsCompatible for Vec<T> {
    #[inline]
    fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
        self.as_slice().is_compatible(browsers)
    }
}

// A blanket
// `impl<L: ListContainer>` conflicts with the `&T` impl above (coherence can't
// prove `&T` never impls `ListContainer`), so spell out the three concrete
// container types instead.
macro_rules! is_compatible_container {
    ($(($($gen:tt)*) $ty:ty),* $(,)?) => {$(
        impl<$($gen)*> IsCompatible for $ty
        where
            <$ty as ListContainer>::Item: IsCompatible,
        {
            fn is_compatible(&self, browsers: &crate::targets::Browsers) -> bool {
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
// Each leaf value
// type either hand-writes an inherent `parse(&mut Parser) -> CssResult<Self>`
// or derives one via `#[derive(Parse)]` / `#[derive(DefineEnumProperty)]`; the
// trait below is the uniform bound that `Property::parse` and the container
// blanket impls (`SmallList`/`Vec`/`Option`/`Size2D`/`Rect`) need.
//
// `Parse` is intentionally lifetime-free: every value-type parser takes
// `&mut Parser<'_>` (the borrowed source slice) and returns an owned value.
// `'bump` arena threading is a follow-up; until then the parser
// holds the arena and arena-backed lists go through `from_list(Vec)`.

/// `T::parse(&mut Parser) -> CssResult<T>`.
pub trait Parse: Sized {
    fn parse(input: &mut Parser) -> CssResult<Self>;
}

/// `T::parse_with_options(&mut Parser, &ParserOptions) -> CssResult<T>`.
///
/// Falling back to `parse` when a type has no `parse_with_options`
/// can't be expressed as a `where Self: Parse` default method
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

// Parse the pointee then heap-allocate.
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
pub(crate) fn to_css<T: ToCss>(this: &T, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
    this.to_css(dest)
}

impl<T: ToCss + ?Sized> ToCss for &T {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        (**self).to_css(dest)
    }
}

// Recurse into the pointee.
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
        CSSNumberFns::to_css(*self, dest)
    }
}
impl ToCss for CSSInteger {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSIntegerFns::to_css(*self, dest)
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
                (*self).to_css(dest)
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

impl TryFromAngle for CSSNumber {
    #[inline]
    fn try_from_angle(angle: Angle) -> Option<Self> {
        CSSNumberFns::try_from_angle(angle)
    }
}

pub trait TrySign {
    fn try_sign(&self) -> Option<f32>;
}

impl TrySign for CSSNumber {
    #[inline]
    fn try_sign(&self) -> Option<f32> {
        Some(CSSNumberFns::sign(*self))
    }
}
// Each type
// implements `TrySign` explicitly (delegating to its inherent `sign` where one exists).

pub trait TryMap: Sized {
    // Generic param preserves monomorphization.
    fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self>;
}

impl TryMap for CSSNumber {
    #[inline]
    fn try_map(&self, map_fn: impl Fn(f32) -> f32) -> Option<Self> {
        Some(map_fn(*self))
    }
}

pub trait TryOpTo: Sized {
    // Generic param preserves monomorphization.
    // `R` is method-generic (not trait-generic) so `TryOpTo` can appear as a
    // supertrait bound without committing to a result type.
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R>;
}

impl TryOpTo for CSSNumber {
    #[inline]
    fn try_op_to<R, C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> R) -> Option<R> {
        Some(op_fn(ctx, *self, *rhs))
    }
}

impl IsCompatible for CSSNumber {
    #[inline]
    fn is_compatible(&self, _: &crate::targets::Browsers) -> bool {
        true
    }
}

pub trait TryOp: Sized {
    // Generic param preserves monomorphization.
    fn try_op<C>(&self, rhs: &Self, ctx: C, op_fn: impl Fn(C, f32, f32) -> f32) -> Option<Self>;
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
pub(crate) fn partial_cmp_f32(lhs: f32, rhs: f32) -> Option<Ordering> {
    let lte = lhs <= rhs;
    let rte = lhs >= rhs;
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
        partial_cmp_f32(*self, *rhs)
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
