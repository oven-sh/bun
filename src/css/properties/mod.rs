//! CSS property definitions.

#![warn(unused_must_use)]

// `properties_generated.rs` carries the 249-variant `Property` /
// `PropertyId` / `PropertyIdTag` enums referenced by `declaration.rs`,
// `context.rs`, and `rules/`. Every *value type* the `Property` enum names is
// re-exposed below via `pub mod $name`.

// ─── Rect / Size shorthand impl + define macros ────────────────────────────
// Shared by `border.rs` and `margin_padding.rs`.
//
// `impl_rect_shorthand!` / `impl_size_shorthand!` stamp out the inherent
// `parse`/`to_css` pair (and the `generic::{Parse,ToCss}` forwarders) for a
// pre-existing struct. Rust has no field reflection, so the size-shorthand
// field names are passed in (`start`/`end` for border, `block_start`/… for
// margin_padding).
//
// `define_rect_shorthand!` is the full mixin: it emits the struct
// `{top,right,bottom,left}`, `deep_clone`/`eql`, *and* calls
// `impl_rect_shorthand!`. Used by
// the 8 rect-shorthand value types in border.rs / margin_padding.rs so the
// boilerplate isn't hand-copied per type.
//
// Declared here (textually before `pub mod border;` / `pub mod
// margin_padding;`) so macro_rules! scoping makes them visible in both
// submodules without `#[macro_export]`.
macro_rules! impl_rect_shorthand {
    ($T:ident, $V:ty) => {
        impl $T {
            pub fn parse(input: &mut $crate::css_parser::Parser) -> $crate::Result<Self> {
                let r = $crate::css_values::rect::Rect::<$V>::parse(input)?;
                Ok(Self {
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom,
                    left: r.left,
                })
            }
            pub fn to_css(
                &self,
                dest: &mut $crate::printer::Printer,
            ) -> ::core::result::Result<(), $crate::PrintErr> {
                $crate::css_values::rect::Rect::<&$V> {
                    top: &self.top,
                    right: &self.right,
                    bottom: &self.bottom,
                    left: &self.left,
                }
                .to_css(dest)
            }
        }
        $crate::impl_parse_tocss_via_inherent!($T);
    };
}

macro_rules! define_rect_shorthand {
    (
        $(#[$meta:meta])*
        $name:ident, $inner:ty,
        top: $top_id:ident,
        right: $right_id:ident,
        bottom: $bottom_id:ident,
        left: $left_id:ident
        $(, fallbacks)?
    ) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq)]
        pub struct $name {
            pub top: $inner,
            pub right: $inner,
            pub bottom: $inner,
            pub left: $inner,
        }

        // parse/to_css via `Rect<V>`.
        impl_rect_shorthand!($name, $inner);
    };
}

macro_rules! impl_size_shorthand {
    ($T:ident, $V:ty, $start:ident, $end:ident) => {
        impl $T {
            pub fn parse(input: &mut $crate::css_parser::Parser) -> $crate::Result<Self> {
                let s = $crate::css_values::size::Size2D::<$V>::parse(input)?;
                Ok(Self {
                    $start: s.a,
                    $end: s.b,
                })
            }
            pub fn to_css(
                &self,
                dest: &mut $crate::printer::Printer,
            ) -> ::core::result::Result<(), $crate::PrintErr> {
                self.$start.to_css(dest)?;
                if self.$start != self.$end {
                    dest.write_str(b" ")?;
                    self.$end.to_css(dest)?;
                }
                Ok(())
            }
        }
        $crate::impl_parse_tocss_via_inherent!($T);
    };
}

// ─── Submodule declarations ────────────────────────────────────────────────
//
pub mod align;
pub mod animation;
pub mod background;
pub mod border;
pub mod border_image;
pub mod border_radius;
pub mod box_shadow;
pub mod display;
pub mod flex;
pub mod font;
pub mod margin_padding;
pub mod masking;
pub mod outline;
pub mod overflow;
pub mod position;
pub mod prefix_handler;
pub mod shape;
pub mod size;
pub mod text;
pub mod transform;
pub mod transition;
pub mod ui;

pub mod css_modules;

pub mod custom;

pub mod properties_generated;
mod properties_impl;

// ─── Re-exports ────────────────────────────────────────────────────────────

pub use self::custom::CustomPropertyName;
pub use self::properties_generated::{Property, PropertyId, PropertyIdTag};

/// A [CSS-wide keyword](https://drafts.csswg.org/css-cascade-5/#defaulting-keywords).
// The `DefineEnumProperty` derive emits `EnumProperty` +
// `From<Self> for &'static str` + inherent `parse`/`to_css`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, crate::DefineEnumProperty)]
pub enum CSSWideKeyword {
    /// The property's initial value.
    Initial,
    /// The property's computed value on the parent element.
    Inherit,
    /// Either inherit or initial depending on whether the property is inherited.
    Unset,
    /// Rolls back the cascade to the cascaded value of the earlier origin.
    Revert,
    /// Rolls back the cascade to the value of the previous cascade layer.
    RevertLayer,
}

// ─── generic::{Parse,ToCss,ParseWithOptions} leaf-type registrations ───────
// `Property::parse` / `Property::value_to_css` (properties_generated.rs)
// dispatch through `css::generic::{parse_with_options,to_css}`, which require
// every payload type to implement the protocol traits in `crate::generics`.
// Each leaf already has inherent `parse` / `to_css` (hand-written or via
// `#[derive(Parse, ToCss)]` / `#[derive(DefineEnumProperty)]`); the
// `impl_parse_tocss_via_inherent!` macro forwards to those. Shorthand families that
// generate their own impls inside their declaring macro (border rect/size,
// margin_padding rect/size) are not re-listed here.
mod generic_registrations {
    use super::*;
    use crate::css_values;
    use crate::impl_parse_tocss_via_inherent;
    use crate::properties::border::GenericBorder;

    // ── crate::values::* leaves ──
    // None of these derive `Parse`/`ToCss`/`DefineEnumProperty`; they have
    // hand-written inherent `parse`/`to_css`, so forward via the macro.
    impl_parse_tocss_via_inherent!(
        css_values::alpha::AlphaValue,
        css_values::image::Image,
        css_values::length::LengthPercentage,
        css_values::easing::EasingFunction,
        css_values::time::Time,
        css_values::position::Position,
        css_values::position::HorizontalPosition,
        css_values::position::VerticalPosition,
        css_values::percentage::NumberOrPercentage,
    );

    // Length derives `css::ToCss` only (custom Calc-unwrapping `parse` is
    // inherent); CssColor has a hand-written `generics::ToCss` in
    // `values/color.rs`. Supply `Parse` / `ParseWithOptions` only for both.
    impl crate::generics::Parse for css_values::length::Length {
        #[inline]
        fn parse(input: &mut crate::css_parser::Parser) -> crate::css_parser::CssResult<Self> {
            css_values::length::Length::parse(input)
        }
    }
    impl crate::generics::ParseWithOptions for css_values::length::Length {
        #[inline]
        fn parse_with_options(
            input: &mut crate::css_parser::Parser,
            _o: &crate::css_parser::ParserOptions,
        ) -> crate::css_parser::CssResult<Self> {
            css_values::length::Length::parse(input)
        }
    }
    impl crate::generics::Parse for css_values::color::CssColor {
        #[inline]
        fn parse(input: &mut crate::css_parser::Parser) -> crate::css_parser::CssResult<Self> {
            css_values::color::CssColor::parse(input)
        }
    }
    impl crate::generics::ParseWithOptions for css_values::color::CssColor {
        #[inline]
        fn parse_with_options(
            input: &mut crate::css_parser::Parser,
            _o: &crate::css_parser::ParserOptions,
        ) -> crate::css_parser::CssResult<Self> {
            css_values::color::CssColor::parse(input)
        }
    }

    // ── crate::properties::* leaves with REAL inherent parse/to_css ──
    // NOTE: types deriving `css::DefineEnumProperty` / `Parse` / `ToCss` already
    // get `generics::{Parse,ParseWithOptions,ToCss}` from the derive — listing
    // them here would conflict (E0119). Only payloads with hand-written
    // inherent `parse`/`to_css` (no derive) need the forwarding shim.
    impl_parse_tocss_via_inherent!(
        // align
        align::Gap,
        align::JustifyContent,
        align::JustifyItems,
        align::JustifySelf,
        align::PlaceContent,
        align::PlaceItems,
        align::PlaceSelf,
        // background
        background::Background,
        background::BackgroundPosition,
        background::BackgroundRepeat,
        background::BackgroundSize,
        // border_image
        border_image::BorderImage,
        border_image::BorderImageRepeat,
        border_image::BorderImageSlice,
        border_image::BorderImageSideWidth,
        // border_radius
        border_radius::BorderRadius,
        // box_shadow
        box_shadow::BoxShadow,
        // css_modules
        css_modules::Composes,
        // display
        display::Display,
        // flex
        flex::Flex,
        flex::FlexFlow,
        // font
        font::Font,
        font::FontFamily,
        font::FontStretch,
        font::FontStyle,
        font::FontWeight,
        font::LineHeight,
        // masking
        masking::Mask,
        masking::MaskBorder,
        // overflow
        overflow::Overflow,
        // position
        position::Position,
        // size
        size::AspectRatio,
        size::BoxSizing,
        size::MaxSize,
        size::Size,
        // text
        text::TextShadow,
        // transform
        transform::Rotate,
        transform::Scale,
        transform::TransformList,
        transform::Translate,
        // transition
        transition::Transition,
        // animation
        animation::Animation,
        animation::AnimationName,
        // ui
        ui::ColorScheme,
        // PropertyId (used as `SmallList<PropertyId, 1>` for `transition-property`)
        properties_generated::PropertyId,
    );

    // `GenericBorder<S, P>` covers Border / BorderTop / … / Outline. The
    // inherent impl block bounds `S` on the protocol traits; mirror here.
    impl<S, const P: u8> crate::generics::Parse for GenericBorder<S, P>
    where
        GenericBorder<S, P>: GenericBorderImpl,
    {
        #[inline]
        fn parse(input: &mut crate::css_parser::Parser) -> crate::css_parser::CssResult<Self> {
            <Self as GenericBorderImpl>::parse(input)
        }
    }
    impl<S, const P: u8> crate::generics::ParseWithOptions for GenericBorder<S, P>
    where
        GenericBorder<S, P>: GenericBorderImpl,
    {
        #[inline]
        fn parse_with_options(
            input: &mut crate::css_parser::Parser,
            _o: &crate::css_parser::ParserOptions,
        ) -> crate::css_parser::CssResult<Self> {
            <Self as GenericBorderImpl>::parse(input)
        }
    }
    impl<S, const P: u8> crate::generics::ToCss for GenericBorder<S, P>
    where
        GenericBorder<S, P>: GenericBorderImpl,
    {
        #[inline]
        fn to_css(
            &self,
            dest: &mut crate::printer::Printer,
        ) -> ::core::result::Result<(), crate::PrintErr> {
            <Self as GenericBorderImpl>::to_css(self, dest)
        }
    }

    /// Indirection so the `generic::{Parse,ToCss}` impls above don't have to
    /// repeat `GenericBorder`'s `S`-bounds (which name the same protocol
    /// traits and would otherwise create a coherence cycle).
    pub(crate) trait GenericBorderImpl: Sized {
        fn parse(input: &mut crate::css_parser::Parser) -> crate::css_parser::CssResult<Self>;
        fn to_css(
            &self,
            dest: &mut crate::printer::Printer,
        ) -> ::core::result::Result<(), crate::PrintErr>;
    }
}
pub(crate) use generic_registrations::GenericBorderImpl;
